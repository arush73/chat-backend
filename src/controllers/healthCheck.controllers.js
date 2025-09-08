import { asyncHandler } from "../utils/asyncHandler.js"
import { ApiResponse } from "../utils/ApiResponse.js"

const healthCheck = asyncHandler(async (req, res) => {
  res.status(200).json(new ApiResponse(200, "Server is healthy", null))
})

export default healthCheck
