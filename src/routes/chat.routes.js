import { Router } from "express"
import { verifyJWT } from "../middlewares/auth.middleware.js"

const router = Router()
router.use(verifyJWT)

import {
  getAllChats,
  searchAvailableUsers,
  createOrGetAOneOnOneChat,
  createGroupChat,
  getGroupChatDetails,
  renameGroupChat,
  deleteGroupChat,
  addNewParticipantInGroupChat,
  removeParticipantFromGroupChat,
  leaveGroupChat,
  deleteOneOnOneChat,
} from "../controllers/chat.controllers.js"

router.route("/").get(getAllChats)

router.route("/users").get(searchAvailableUsers)

router.route("/c/:receiverId").post(createOrGetAOneOnOneChat)

router.route("/group").post(createGroupChat)

router
  .route("/group/:chatId")
  .get(getGroupChatDetails)
  .patch(renameGroupChat)
  .delete(deleteGroupChat)

router
  .route("/group/:chatId/:participantId")
  .post(addNewParticipantInGroupChat)
  .delete(removeParticipantFromGroupChat)

router.route("/leave/group/:chatId").delete(leaveGroupChat)

router.route("/remove/:chatId").delete(deleteOneOnOneChat)

export default router
