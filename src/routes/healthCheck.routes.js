import { Router } from "express"

const router = Router()

import healthCheck from "../controllers/healthCheck.controllers.js"

router.route("/").get(healthCheck)

export default router
