import dotenv from "dotenv"
dotenv.config()

import connectDB from "./utils/db.js"
import logger from "./logger/winston.logger.js"
import app from "./app.js"
import http from "http"
import {Server} from "socket.io"

const server = http.createServer(app)

const io = new Server(httpServer, {
  pingTimeout: 60000,
  cors: {
    origin: process.env.CORS_ORIGIN,
    credentials: true,
  },
})

app.use("io", io)

io.on("connection", (socket) => {
  console.log("web socket is connected: ", socket.id)
})

const startServer = () => {
  server.listen(process.env.PORT || 8080, () => {
    logger.info(
      `📑 visit the server at: http://localhost:${process.env.PORT || 8080}`
    )
    logger.info("⚙️  Server is running on port: " + process.env.PORT)
  })
}

connectDB()
  .then(() => {
    startServer()
  })
  .catch((err) => {
    logger.error("Mongo db connect error: ", err)
  })
