import { Router } from "express"
import { verifyJWT } from "../middlewares/auth.middleware.js"
import { upload } from "../middlewares/multer.middleware.js"

const router = Router()
router.use(verifyJWT)

import {} from "../controllers/message.controllers.js"

router
  .route("/:chatId")
  .get(getAllMessage)
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
