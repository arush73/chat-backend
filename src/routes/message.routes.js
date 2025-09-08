import { Router } from "express"
import { verifyJWT } from "../middlewares/auth.middleware.js"
import { upload } from "../middlewares/multer.middleware.js"

const router = Router()
router.use(verifyJWT)

import {
  getAllMessages,
  sendMessage,
  deleteMessage,
} from "../controllers/message.controllers.js"

router
  .route("/:chatId")
  .get(getAllMessages)
  .post(
    upload.fields([
      {
        name: "attachments",
        maxCount: 5,
      },
    ]),
    sendMessage
  )

router.route("/:chatId/:messageId").delete(deleteMessage)

export default router
