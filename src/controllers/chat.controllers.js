import { asyncHandler } from "../utils/asyncHandler.js"
import { ApiError } from "../utils/ApiError.js"
import { ApiResponse } from "../utils/ApiResponse.js"
import Chat from "../models/message.models.js"
import User from "../models/user.models.js"
import { ChatEventEnum } from "../constants.js"
import mongoose from "mongoose"

const chatCommonAggregation = () => {}

const searchAvailableUsers = asyncHandler(async (req, res) => {
  const users = await User.aggregate([
    {
      $match: {
        _id: {
          $ne: req.user._id, // avoid logged in user
        },
      },
    },
    {
      $project: {
        avatar: 1,
        username: 1,
        email: 1,
      },
    },
  ])

  return res
    .status(200)
    .json(new ApiResponse(200, users, "Users fetched successfully"))
})

const deleteCascadeChatMessages = async (chatId) => {
  // fetch the messages associated with the chat to remove
  const messages = await ChatMessage.find({
    chat: new mongoose.Types.ObjectId(chatId),
  })

  let attachments = []

  // get the attachments present in the messages
  attachments = attachments.concat(
    ...messages.map((message) => {
      return message.attachments
    })
  )

  attachments.forEach((attachment) => {
    // remove attachment files from the local storage
    removeLocalFile(attachment.localPath)
  })

  // delete all the messages
  await ChatMessage.deleteMany({
    chat: new mongoose.Types.ObjectId(chatId),
  })
}

const createOrGetAOneOnOneChat = asyncHandler(async (req, res) => {
  const { receiverId } = req.params

  // Check if it's a valid receiver
  const receiver = await User.findById(receiverId)

  if (!receiver) {
    throw new ApiError(404, "Receiver does not exist")
  }

  // check if receiver is not the user who is requesting a chat
  if (receiver._id.toString() === req.user._id.toString()) {
    throw new ApiError(400, "You cannot chat with yourself")
  }

  const chat = await Chat.aggregate([
    {
      $match: {
        isGroupChat: false, // avoid group chats. This controller is responsible for one on one chats
        // Also, filter chats with participants having receiver and logged in user only
        $and: [
          {
            participants: { $elemMatch: { $eq: req.user._id } },
          },
          {
            participants: {
              $elemMatch: { $eq: new mongoose.Types.ObjectId(receiverId) },
            },
          },
        ],
      },
    },
    ...chatCommonAggregation(),
  ])

  if (chat.length) {
    // if we find the chat that means user already has created a chat
    return res
      .status(200)
      .json(new ApiResponse(200, chat[0], "Chat retrieved successfully"))
  }

  // if not we need to create a new one on one chat
  const newChatInstance = await Chat.create({
    name: "One on one chat",
    participants: [req.user._id, new mongoose.Types.ObjectId(receiverId)], // add receiver and logged in user as participants
    admin: req.user._id,
  })

  // structure the chat as per the common aggregation to keep the consistency
  const createdChat = await Chat.aggregate([
    {
      $match: {
        _id: newChatInstance._id,
      },
    },
    ...chatCommonAggregation(),
  ])

  const payload = createdChat[0] // store the aggregation result

  if (!payload) {
    throw new ApiError(500, "Internal server error")
  }

  // logic to emit socket event about the new chat added to the participants
  payload?.participants?.forEach((participant) => {
    if (participant._id.toString() === req.user._id.toString()) return // don't emit the event for the logged in use as he is the one who is initiating the chat

    // emit event to other participants with new chat as a payload
    emitSocketEvent(
      req,
      participant._id?.toString(),
      ChatEventEnum.NEW_CHAT_EVENT,
      payload
    )
  })
  return res
    .status(201)
    .json(new ApiResponse(201, payload, "Chat retrieved successfully"))
})

const createAGroupChat = asyncHandler(async (req, res) => {
  // const validation =

  const { name, participants } = req.body

  if (participants.includes(req.user._id.toString()))
    throw new ApiError(
      400,
      "Participants array should not contain the group creator"
    )

  // making a set to check for duplicates
  const members = [...new Set([...participants, req.user._id.toString()])]

  if (members.length < 3)
    throw new ApiError(400, "seems like you have passed duplicate participants")

  const groupChat = await Chat.create({
    name,
    isGroupChat: true,
    participants: members,
    admin: req.user._id,
  })

  // structure the chat (will have to learn aggregation pipelines !!!!! else will suffer)
  const chat = await Chat.aggregate([
    {
      $match: {
        _id: groupChat._id,
      },
    },
    ...chatCommonAggregation(),
  ])

  const payload = chat[0]

  if (!payload)
    throw new ApiError(500, "Internal server error (pipeline sucks)")

  // this is very much the core thing that i needed to learn !!
  // socket stuff !!!!!
  // this is all the main logic will study after gym!!!
  payload?.participants?.forEach((participant) => {
    if (participant._id.toString() === req.user._id.toString()) return // don't emit the event for the logged in use as he is the one who is initiating the chat
    // emit event to other participants with new chat as a payload
    emitSocketEvent(
      req,
      participant._id?.toString(),
      ChatEventEnum.NEW_CHAT_EVENT,
      payload
    )
  })

  return res
    .status(201)
    .json(new ApiResponse(201, "group chat created successfully", paylaod))
})

const getGroupChatDetails = asyncHandler(async () => {
  const { chatId } = req.params

  if (!chatId) throw new ApiError(400, "chatId not found in the req params")

  const groupChat = await Chat.aggregate([
    {
      $match: {
        _id: new mongoose.Types.ObjectId(chatId),
        isGroupChat: true,
      },
    },
    ...chatCommonAggregation(),
  ])

  const chat = groupChat[0]

  if (!chat) throw new ApiError(404, "chat does not exist")

  return res
    .status(200)
    .json(new ApiResponse(200, "group chat fetched successfully", chat))
})

const renameGroupChat = asyncHandler(async () => {
  const { chatId } = req.params
  if (!chatId) throw new ApiError(400, "chatId not found in the req params")

  const { name } = req.body

  const groupChat = await Chat.findOne({
    _id: new mongoose.Types.ObjectId(chatId),
    isGroupChat: true,
  })

  if (!groupChat) throw new ApiError(404, "group chat does not exist")

  if (groupChat.admin?.toString() !== req.user._id.toString())
    throw new ApiError(
      404,
      "you are not allowed to rename the chat as you are not an admin"
    )

  const updatedChatGroup = await Chat.findByIdAndUpdate(
    chatId,
    {
      $set: {
        name,
      },
    },
    { new: true }
  )

  const chat = await Chat.aggregate([
    {
      $match: {
        _id: updatedGroupChat._id,
      },
    },
    ...chatCommonAggregation(),
  ])

  const payload = chat[0]

  if (!payload) {
    throw new ApiError(500, "Internal server error")
  }

  payload?.participants?.forEach((participant) => {
    emitSocketEvent(
      req,
      participant._id?.toString(),
      ChatEventEnum.UPDATE_GROUP_NAME_EVENT,
      payload
    )
  })

  return res
    .status(200)
    .json(new ApiResponse(200, "Group chat name updated successfully", chat[0]))
})

const deleteGroupChat = asyncHandler(async (req, res) => {
  const { chatId } = req.params

  const groupChat = await Chat.aggregate([
    {
      $match: {
        _id: new mongoose.Types.ObjectId(chatId),
        isGroupChat: true,
      },
    },
    ...chatCommonAggregation(),
  ])

  const chat = groupChat[0]

  if (!chat) {
    throw new ApiError(404, "Group chat does not exist")
  }

  if (chat.admin?.toString() !== req.user._id?.toString()) {
    throw new ApiError(404, "Only admin can delete the group")
  }

  await Chat.findByIdAndDelete(chatId)

  await deleteCascadeChatMessages(chatId) // remove all messages and attachments associated with the chat

  // logic to emit socket event about the group chat deleted to the participants
  chat?.participants?.forEach((participant) => {
    if (participant._id.toString() === req.user._id.toString()) return // don't emit the event for the logged in use as he is the one who is deleting
    // emit event to other participants with left chat as a payload
    emitSocketEvent(
      req,
      participant._id?.toString(),
      ChatEventEnum.LEAVE_CHAT_EVENT,
      chat
    )
  })

  return res
    .status(200)
    .json(new ApiResponse(200, "Group chat deleted successfully", {}))
})

export {
  searchAvailableUsers,
  createOrGetAOneOnOneChat,
  createAGroupChat,
  renameGroupChat,
  deleteGroupChat,
  deleteOneOnOneChat,
}
