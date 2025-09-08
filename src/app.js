import dotenv from "dotenv"
dotenv.config()
import express from "express"
import cookieParser from "cookie-parser"
import { rateLimit } from "express-rate-limit"
import cors from "cors"
import morganMiddleware from "./logger/morgan.logger.js"
import session from "express-session"
import passport from "passport"
import { initializeSocketIO } from "./socket/index.js"

const app = express()
console.log(process.env.EXPRESS_SESSION_SECRET)

app.use(express.json({ limit: "16kb" }))
app.use(express.urlencoded({ extended: true, limit: "16kb" }))
app.use(express.static("public"))
app.use(cookieParser())
app.use(
  cors({
    origin:
      process.env.CORS_ORIGIN === "*"
        ? "*" // This might give CORS error for some origins due to credentials set to true
        : process.env.CORS_ORIGIN?.split(","), // For multiple cors origin for production. Refer https://github.com/hiteshchoudhary/apihub/blob/a846abd7a0795054f48c7eb3e71f3af36478fa96/.env.sample#L12C1-L12C12
    credentials: true,
  })
)

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5000,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req, res) => {
    return req.clientIp
  },
  handler: (_, __, ___, options) => {
    throw new ApiError(
      options.statusCode || 500,
      `There are too many requests. You are only allowed ${
        options.max
      } requests per ${options.windowMs / 60000} minutes`
    )
  },
})
app.use(limiter)
app.use(morganMiddleware)
app.use(
  session({
    secret: process.env.EXPRESS_SESSION_SECRET,
    resave: true,
    saveUninitialized: true,
  })
)
app.use(passport.initialize())
app.use(passport.session())

// importing routes
import healthcheckRouter from "./routes/healthCheck.routes.js"
import authRouter from "./routes/auth.routes.js"
import chatRouter from "./routes/chat.routes.js"
import messageRouter from "./routes/message.routes.js"

// decalring routes
app.use("/api/v1/healthcheck", healthcheckRouter)
app.use("/api/v1/users", authRouter)
app.use("/api/v1/chats", chatRouter)
app.use("/api/v1/messages", messageRouter)

export default app
