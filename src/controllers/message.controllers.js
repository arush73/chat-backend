import { asyncHandler } from "../utils/asyncHandler.js"
import { ApiError } from "../utils/ApiError.js"
import { ApiResponse, ApResponse } from "../utils/ApiResponse.js"
import ChatMessage from "../models/message.models.js"
import Chat from "../models/chat.models.js"
import mongoose from "mongoose"
import { ChatEventEnum } from "../constants.js"

const chatMessageCommonAggregation = () => {
  return [
    {
      $lookup: {
        from: "users",
        foreignField: "_id",
        localField: "sender",
        as: "sender",
        pipeline: [
          {
            $project: {
              username: 1,
              avatar: 1,
              email: 1,
            },
          },
        ],
      },
    },
    {
      $addFields: {
        sender: { $first: "$sender" },
      },
    },
  ]
}

const getAllMessages = asyncHandler(async (req, res) => {
  const { chatId } = req.params
  if (!chatId) throw new ApiError(400, "chatId not found in the params")

  const selectedChat = await ChatMessage.findById(chatId)

  if (!selectedChat) throw new ApiError(404, "chat not found")

  const messages = await ChatMessage.aggregate([
    {
      $match: {
        chat: new mongoose.Types.ObjectId(chatId),
      },
    },
    ...chatMessageCommonAggregation(),
    {
      $sort: {
        updatedAt: -1,
      },
    },
  ])

  return res
    .status(200)
    .json(new ApiResponse(200, "messages fetched successfully"))
})

const sendMessage = asyncHandler(async (req, res) => {
  const { chatId } = req.params
  const { content } = req.body

  if (!content && req.files?.attachments?.length)
    throw new ApiError(400, "both content and attachments are missing")

  const selectedChat = await Chat.findByid(chatId)

  if (!selectedChat) throw new ApiError(404, "chat does not exist")

  const messageFiles = []

  // write the code for uploading to cloudinary
  // if (req.files && req.files.attachments?.length > 0) {
  //   req.files.attachments?.map((attachment) => {
  //     messageFiles.push({
  //       url: getStaticFilePath(req, attachment.filename),
  //       localPath: getLocalPath(attachment.filename),
  //     })
  //   })
  // }

  const message = await ChatMessage.create({
    sender: new mongoose.Types.ObjectId(req.user._id),
    content: content,
    chat: new mongoose.Types.ObjectId(chatId),
    // attachments:
  })

  const chat = await Chat.findByIdAndUpdate(
    chatId,
    {
      $set: { lastMessage: message._id },
    },
    { new: true }
  )

  // structure the message
  const messages = await ChatMessage.aggregate([
    {
      $match: {
        _id: new mongoose.Types.ObjectId(message._id),
      },
    },
    ...chatMessageCommonAggregation(),
  ])

  const receivedMessage = messages[0]

  if (!receivedMessage) throw new ApiError(500, "Internal server error")

  chat.participants.forEach((participantObjectId) => {
    // here the chat is the raw instance of the chat in which participants is the array of object ids of users
    // avoid emitting event to the user who is sending the message
    if (participantObjectId.toString() === req.user._id.toString()) return

    // emit the receive message event to the other participants with received message as the payload
    emitSocketEvent(
      req,
      participantObjectId.toString(),
      ChatEventEnum.MESSAGE_RECEIVED_EVENT,
      receivedMessage
    )
  })

  return res
    .status(201)
    .json(new ApiResponse(201, "Message saved successfully", receivedMessage))
})

const deleteMessage = asyncHandler(async (req, res) => {
  const { chatId, messageId } = req.params

  if (!chatId || !messageId)
    throw new ApiError(400, "chatId or messageId not found in the req params")

  //Find the chat based on chatId and checking if user is a participant of the chat
  const chat = await Chat.findOne({
    _id: new mongoose.Types.ObjectId(chatId),
    participants: req.user?._id,
  })

  if (!chat) throw new ApiError(404, "Chat does not exist")

  //Find the message based on message id
  const message = await ChatMessage.findOne({
    _id: new mongoose.Types.ObjectId(messageId),
  })

  if (!message) throw new ApiError(404, "Message does not exist")

  // Check if user is the sender of the message
  if (message.sender.toString() !== req.user._id.toString()) {
    throw new ApiError(
      403,
      "You are not the authorised to delete the message, you are not the sender"
    )
  }
  // login to delete from cloudinary as saved earlier
  //   if (message.attachments.length > 0) {
  //     //If the message is attachment  remove the attachments from the server
  //     message.attachments.map((asset) => {
  //       removeLocalFile(asset.localPath)
  //     })
  //   }

  //deleting the message from DB
  await ChatMessage.deleteOne({
    _id: new mongoose.Types.ObjectId(messageId),
  })

  //Updating the last message of the chat to the previous message after deletion if the message deleted was last message
  if (chat.lastMessage.toString() === message._id.toString()) {
    const lastMessage = await ChatMessage.findOne(
      {
        chat: chatId,
      },
      {},
      {
        sort: {
          createdAt: -1,
        },
      }
    )

    await Chat.findByIdAndUpdate(chatId, {
      lastMessage: lastMessage ? lastMessage?._id : null,
    })
  }

  // logic to emit socket event about the message deleted  to the other participants
  chat.participants.forEach((participantObjectId) => {
    // here the chat is the raw instance of the chat in which participants is the array of object ids of users
    // avoid emitting event to the user who is deleting the message
    if (participantObjectId.toString() === req.user._id.toString()) return
    // emit the delete message event to the other participants frontend with delete messageId as the payload
    emitSocketEvent(
      req,
      participantObjectId.toString(),
      ChatEventEnum.MESSAGE_DELETE_EVENT,
      message
    )
  })

  return res
    .status(200)
    .json(new ApiResponse(200, message, "Message deleted successfully"))
})

export { getAllMessages, sendMessage, deleteMessage }
