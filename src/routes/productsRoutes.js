import express from "express"
import {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  getStockMovements,
  createStockMovement,
  getStockAlerts,
  getStockStats,
  getTopSellingProducts,
  importProductsFromExcel,
  downloadExcelTemplate,
} from "../controllers/products.controller.js"
import { authenticateToken, requireRole } from "../middleware/auth.js"
import { validateCreateProduct, validateUpdateProduct, validateStockMovement } from "../middleware/validation.js"
import multer from "multer"

const router = express.Router()

const storage = multer.memoryStorage()
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
      "application/vnd.ms-excel", // .xls
    ]
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error("Solo se permiten archivos Excel (.xlsx, .xls)"))
    }
  },
})

// Todas las rutas requieren autenticación
router.use(authenticateToken)

router.get("/import/template", downloadExcelTemplate)
router.post("/import/excel", upload.single("file"), importProductsFromExcel)

// Rutas de productos
router.get("/", getProducts)
router.get("/top-selling", getTopSellingProducts)
router.get("/stats", getStockStats)
router.get("/alerts", getStockAlerts)
router.get("/:id", getProductById)
router.post("/", validateCreateProduct, createProduct)
router.put("/:id", validateUpdateProduct, updateProduct)
router.delete("/:id", requireRole(["admin"]), deleteProduct)

// Rutas de movimientos de stock
router.get("/movements/list", getStockMovements)
router.post("/movements", validateStockMovement, createStockMovement)

export default router
