import { v2 as cloudinary } from "cloudinary"
import logger from "../logger/winston.logger.js"
import fs from "fs"
import { ApiError } from "../utils/ApiError.js"
import dotenv from "dotenv"
dotenv.config()

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

const uploadCloudinary = async (localFilePath) => {
  try {
    if (!localFilePath) return null

    const upload = await cloudinary.uploader.upload(localFilePath, {
      resource_type: "auto",
    })

    return upload 

    fs.unlinkSync(localFilePath)
  } catch (err) {
    logger.error(err.message)
    fs.unlinkSync(localFilePath)
    return null
  }
}

const deleteCloudinary = async (cloudinaryUrl) => {
  try {
    const parts = cloudinaryUrl.split("/")
    const filename = parts.pop()

    if (!filename || !filename.includes(".")) {
      throw new Error("Invalid Cloudinary URL format")
    }

    const publicId = filename.split(".")[0]
    if (!publicId)
      throw new ApiError(404, "Unable to extract publicId from Cloudinary URL")

    const response = await cloudinary.uploader.destroy(publicId)
  } catch (err) {
    logger.error(err.message)
    return null
  }
}

export { uploadCloudinary, deleteCloudinary }
