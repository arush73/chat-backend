import { asyncHandler } from "../utils/asyncHandler.js"
import { ApiError } from "../utils/ApiError.js"
import { ApiResponse } from "../utils/ApiResponse.js"
import User from "../models/user.models.js"
import {
  registerUserSchema,
  loginUserSchema,
  forgotPasswordSchema,
  resetForgottenPasswordSchema,
} from "../validators/auth.validators.js"
import { UserRolesEnum, UserLoginType } from "../constants.js"
import { emailVerificationMailgenContent, forgotPasswordMailgenContent, sendMail } from "../utils/mail.js"
import crypto from "crypto"
import { uploadCloudinary } from "../utils/cloudinary.js"
import jwt from "jsonwebtoken"

const cookieOptions = () => {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Strict",
  }
}

const registerUser = asyncHandler(async (req, res) => {
  const validate = registerUserSchema.safeParse(req.body)
  if (!validate.success)
    throw new ApiError(
      401,
      validate.error.issues.map((mess) => mess.message)
    )

  const { username, email, password } = req.body

  const existingUser = await User.findOne({
    $or: [{ username }, { email }],
  })
  if (existingUser)
    throw new ApiError(409, "user with username or email already exists")

  const user = await User.create({
    username,
    email,
    password,
    isEmailVerified: false,
    // role: role || UserRolesEnum.USER
  })

  const { unHashedToken, hashedToken, tokenExpiry } =
    user.generateTemporaryToken()

  user.emailVerificationToken = hashedToken
  user.emailVerificationExpiry = tokenExpiry
  await user.save({ validateBeforeSave: false })

  await sendMail({
    email: user?.email,
    subject: "Please verify your email",
    mailgenContent: emailVerificationMailgenContent(
      user.username,
      `${req.protocol}://${req.get(
        "host"
      )}/api/v1/users/verify-email/${unHashedToken}`
    ),
  })

  const createdUser = await User.findById(user._id).select(
    "-password -refreshToken -emailVerificationToken -emailVerificationExpiry"
  )

  if (!createdUser)
    throw new ApiError(500, "Something went wrong while registering the user")
  return res
    .status(201)
    .json(
      new ApiResponse(
        200,
        "User registered successfully and verification email has been sent on your email"
      )
    )
})

const loginUser = asyncHandler(async (req, res) => {
  const validate = loginUserSchema.safeParse(req.body)
  if (!validate.success)
    throw new ApiError(
      400,
      validate.error.issues.map((mess) => mess.message)
    )

  const { email, username, password } = req.body

  const user = await User.findOne({
    $and: [{ username }, { email }],
  })

  if (!user) throw new ApiError(404, "User with provided username and email does not exist")

  if (user.loginType !== UserLoginType.EMAIL_PASSWORD) {
    throw new ApiError(
      400,
      "You have previously registered using " +
        user.loginType?.toLowerCase() +
        ". Please use the " +
        user.loginType?.toLowerCase() +
        " login option to access your account."
    )
  }

  const isPasswordValid = await user.isPasswordCorrect(password)

  if (!isPasswordValid) throw new ApiError(400, "invalid credentials")

  const accessToken = user.generateAccessToken()
  const refreshToken = user.generateRefreshToken()

  const loggedInUser = await User.findById(user._id).select(
    "-password -refreshToken -emailVerificationToken -emailVerificationExpiry"
  )

  loggedInUser.refreshToken = refreshToken
  await loggedInUser.save({ validateBeforeSave: false })
  
  return res
    .status(200)
    .cookie("accessToken", accessToken, cookieOptions())
    .cookie("refreshToken", refreshToken, cookieOptions())
    .json(
      new ApiResponse(200, "User logged in successfully", {
        user: loggedInUser,
        accessToken,
        refreshToken,
      })
    )
})

const logoutUser = asyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(
    req.user._id,
    {
      $set: {
        refreshToken: "",
      },
    },
    { new: true }
  )

  return res
    .status(200)
    .clearCookie("accessToken", cookieOptions())
    .clearCookie("refreshToken", cookieOptions())
    .json(new ApiResponse(200, {}, "User logged out"))
})

const verifyEmail = asyncHandler(async (req, res) => {
  const { verificationToken } = req.params

  if (!verificationToken) {
    throw new ApiError(400, "Email verification token is missing")
  }

  let hashedToken = crypto
    .createHash("sha256")
    .update(verificationToken)
    .digest("hex")

  const user = await User.findOne({
    emailVerificationToken: hashedToken,
    emailVerificationExpiry: { $gt: Date.now() },
  })

  if (!user) throw new ApiError(489, "Token is invalid or expired")

  user.emailVerificationToken = undefined
  user.emailVerificationExpiry = undefined
  user.isEmailVerified = true
  await user.save({ validateBeforeSave: false })

  return res
    .status(200)
    .json(new ApiResponse(200, "Email is verified", { isEmailVerified: true }))
})

const refreshAccessToken = asyncHandler(async (req, res) => {
  console.log("req.cookies.refreshToken: ", req.cookies.refreshToken)
  console.log("req.body.refreshToken: ", req.body?.refreshToken)
  const incomingRefreshToken = req.cookies.refreshToken
  console.log("incoming refreh token: ", incomingRefreshToken)

  if (!incomingRefreshToken) throw new ApiError(401, "Unauthorized request")

  try {
    const decodedToken = jwt.verify(
      incomingRefreshToken,
      process.env.REFRESH_TOKEN_SECRET
    )

    const user = await User.findById(decodedToken?._id)
    if (!user) throw new ApiError(401, "Invalid refresh token")

    if (incomingRefreshToken !== user?.refreshToken)
      throw new ApiError(401, "Refresh token is expired or used")

    const accessToken = user.generateAccessToken()
    const newRefreshToken = user.generateRefreshToken()

    user.refreshToken = newRefreshToken
    await user.save()

    return res
      .status(200)
      .cookie("accessToken", accessToken, cookieOptions())
      .cookie("refreshToken", newRefreshToken, cookieOptions())
      .json(
        new ApiResponse(
          200,
          { accessToken, refreshToken: newRefreshToken },
          "Access token refreshed"
        )
      )
  } catch (error) {
    throw new ApiError(401, error?.message || "Invalid refresh token")
  }
})

const forgotPasswordRequest = asyncHandler(async (req, res) => {
  const validate = forgotPasswordSchema.safeParse(req.body)
  if (!validate.success)
    throw new ApiError(
      401,
      validate.error.issues.map((mess) => mess.message)
    )

  const { email } = req.body

  const user = await User.findOne({ email })

  if (!user) throw new ApiError(404, "User does not exists", [])

  const { unHashedToken, hashedToken, tokenExpiry } =
    user.generateTemporaryToken()

  user.forgotPasswordToken = hashedToken
  user.forgotPasswordExpiry = tokenExpiry
  await user.save({ validateBeforeSave: false })

  console.log(await sendMail({
    email: user?.email,
    subject: "Password reset request",
    mailgenContent: forgotPasswordMailgenContent(
      user.username,
      // ! NOTE: Following link should be the link of the frontend page responsible to request password reset
      // ! Frontend will send the below token with the new password in the request body to the backend reset password endpoint
      `${process.env.FORGOT_PASSWORD_REDIRECT_URL}/${unHashedToken}`
    ),
  }))
  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        {},
        "Password reset mail has been sent on your mail id"
      )
    )
})

const resetForgottenPassword = asyncHandler(async (req, res) => {
  const validate = resetForgottenPasswordSchema.safeParse(req.body)
  if (!validate.success)
    throw new ApiError(
      401,
      validate.error.issues.map((mess) => mess.message)
    )

  const { resetToken } = req.params
  const { newPassword } = req.body

  let hashedToken = crypto.createHash("sha256").update(resetToken).digest("hex")

  const user = await User.findOne({
    forgotPasswordToken: hashedToken,
    forgotPasswordExpiry: { $gt: Date.now() },
  })

  if (!user) throw new ApiError(489, "Token is invalid or expired")

  user.forgotPasswordToken = undefined
  user.forgotPasswordExpiry = undefined

  user.password = newPassword
  await user.save({ validateBeforeSave: false })
  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Password reset successfully"))
})

const changeCurrentPassword = asyncHandler(async (req, res) => {
  const validate = resetForgottenPasswordSchema.safeParse(req.body)
  if (!validate.success)
    throw new ApiError(
      401,
      validate.error.issues.map((mess) => mess.message)
    )

  const { oldPassword, newPassword } = req.body

  const user = await User.findById(req.user?._id)

  const isPasswordValid = await user.isPasswordCorrect(oldPassword)

  if (!isPasswordValid) {
    throw new ApiError(400, "Invalid old password")
  }

  user.password = newPassword
  await user.save({ validateBeforeSave: false })

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Password changed successfully"))
})

const getCurrentUser = asyncHandler(async (req, res) => {
  return res
    .status(200)
    .json(new ApiResponse(200, req.user, "Current user fetched successfully"))
})

const updateUserAvatar = asyncHandler(async (req, res) => {
  if (!req.file?.filename) throw new ApiError(400, "Avatar image is required")

  const avatarLocalPath = req.file.path

  if (!avatarLocalPath) throw new ApiError(400, "Avatar file is required")
  const avatar = await uploadCloudinary(avatarLocalPath)
  if (!avatar) throw new ApiError(400, "failed to upload on cloudinary")

  const user = await User.findById(req.user._id)

  let updatedUser = await User.findByIdAndUpdate(
    req.user._id,

    {
      $set: {
        avatar: avatar.url,
      },
    },
    { new: true }
  ).select(
    "-password -refreshToken -emailVerificationToken -emailVerificationExpiry"
  )

  return res
    .status(200)
    .json(new ApiResponse(200, updatedUser, "Avatar updated successfully"))
})

const handleSocialLogin = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user?._id)

  if (!user) {
    throw new ApiError(404, "User does not exist")
  }

  const accessToken = user.generateAccessToken()
  const refreshToken = user.generateRefreshToken()

  return (
    res
      .status(301)
      .cookie("accessToken", accessToken, cookieOptions)
      .cookie("refreshToken", refreshToken, cookieOptions)
      // .redirect(
      //   // redirect user to the frontend with access and refresh token in case user is not using cookies
      //   `${process.env.CLIENT_SSO_REDIRECT_URL}?accessToken=${accessToken}&refreshToken=${refreshToken}`
      // )
      .json(new ApiResponse(200, "user created sucessfully via google", user))
  )
})

export {
  registerUser,
  loginUser,
  logoutUser,
  verifyEmail,
  refreshAccessToken,
  forgotPasswordRequest,
  resetForgottenPassword,
  changeCurrentPassword,
  getCurrentUser,
  updateUserAvatar,
  handleSocialLogin,
}
