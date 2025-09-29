import { executeQuery, executeTransaction } from "../config/database.js"
import xlsx from "xlsx"

// NUEVO: Obtener los 10 productos más vendidos para la interfaz de ventas
export const getTopSellingProducts = async (req, res) => {
  try {
    const limit = Number.parseInt(req.query.limit, 10) || 10

    const query = `
      SELECT 
        p.id,
        p.name,
        p.description,
        p.price,
        p.price_level_1,
        p.price_level_2,
        p.price_level_3,
        p.cost,
        p.stock,
        p.min_stock,
        p.unit_type,
        p.category_id,
        p.barcode,
        p.image,
        p.active,
        p.created_at,
        p.updated_at,
        c.name as category_name,
        c.color as category_color,
        c.icon as category_icon,
        COALESCE(SUM(si.quantity), 0) as total_sold,
        COUNT(DISTINCT s.id) as sales_count
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN sale_items si ON p.id = si.product_id
      LEFT JOIN sales s ON si.sale_id = s.id AND s.status = 'completed'
      WHERE p.active = TRUE
      GROUP BY p.id, p.name, p.description, p.price, p.price_level_1, p.price_level_2, p.price_level_3, p.cost, p.stock, 
               p.min_stock, p.unit_type, p.category_id, p.barcode, p.image, 
               p.active, p.created_at, p.updated_at, c.name, c.color, c.icon
      ORDER BY total_sold DESC, sales_count DESC, p.name ASC
      LIMIT ${limit}
    `

    const rows = await executeQuery(query)

    return res.json({
      success: true,
      data: {
        products: rows,
      },
    })
  } catch (error) {
    console.error("Error al obtener productos más vendidos:", error)
    return res.status(500).json({
      success: false,
      message: "Error al obtener productos más vendidos",
    })
  }
}

// Obtener todos los productos con paginación optimizada
export const getProducts = async (req, res) => {
  try {
    const {
      category,
      active = "true",
      search,
      stockLevel,
      minPrice,
      maxPrice,
      minStock,
      maxStock,
      page = 1,
      limit = 25,
    } = req.query

    let sql = `
      SELECT 
        p.id,
        p.name,
        p.description,
        p.price,
        p.price_level_1,
        p.price_level_2,
        p.price_level_3,
        p.cost,
        p.stock,
        p.min_stock,
        p.unit_type,
        p.category_id,
        p.barcode,
        p.image,
        p.active,
        p.created_at,
        p.updated_at,
        c.name as category_name,
        c.color as category_color,
        c.icon as category_icon
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE 1=1
    `
    const params = []

    // Filtro por estado activo/inactivo
    if (active !== "all") {
      sql += ` AND p.active = ?`
      params.push(active === "true")
    }

    // Filtro por categoría (optimizado con índice)
    if (category && !isNaN(Number.parseInt(category))) {
      sql += ` AND p.category_id = ?`
      params.push(Number.parseInt(category))
    }

    // Filtro por búsqueda de texto (optimizado con índice FULLTEXT)
    if (search && search.trim()) {
      sql += ` AND (p.name LIKE ? OR p.description LIKE ? OR p.barcode LIKE ?)`
      const searchTerm = `%${search.trim()}%`
      params.push(searchTerm, searchTerm, searchTerm)
    }

    // Filtro por nivel de stock
    if (stockLevel && ["critical", "low", "normal", "high"].includes(stockLevel)) {
      switch (stockLevel) {
        case "critical":
          sql += ` AND p.stock = 0`
          break
        case "low":
          sql += ` AND p.stock > 0 AND p.stock <= p.min_stock`
          break
        case "normal":
          sql += ` AND p.stock > p.min_stock AND p.stock <= (p.min_stock * 2)`
          break
        case "high":
          sql += ` AND p.stock > (p.min_stock * 2)`
          break
      }
    }

    // Filtro por rango de stock personalizado
    if (minStock && !isNaN(Number.parseFloat(minStock))) {
      sql += ` AND p.stock >= ?`
      params.push(Number.parseFloat(minStock))
    }
    if (maxStock && !isNaN(Number.parseFloat(maxStock))) {
      sql += ` AND p.stock <= ?`
      params.push(Number.parseFloat(maxStock))
    }

    // Filtro por rango de precios (ahora usando price_level_1 como referencia)
    if (minPrice && !isNaN(Number.parseFloat(minPrice))) {
      sql += ` AND p.price_level_1 >= ?`
      params.push(Number.parseFloat(minPrice))
    }
    if (maxPrice && !isNaN(Number.parseFloat(maxPrice))) {
      sql += ` AND p.price_level_1 <= ?`
      params.push(Number.parseFloat(maxPrice))
    }

    // Ordenamiento optimizado
    sql += ` ORDER BY p.name ASC, p.id ASC`

    // Paginación con validación mejorada
    const pageNum = Math.max(1, Number.parseInt(page) || 1)
    const limitNum = Math.min(100, Math.max(1, Number.parseInt(limit) || 25))
    const offset = (pageNum - 1) * limitNum

    // Crear consulta para el total (optimizada)
    let countSql = `SELECT COUNT(*) as total FROM products p WHERE 1=1`
    const countParams = []

    if (active !== "all") {
      countSql += ` AND p.active = ?`
      countParams.push(active === "true")
    }
    if (category && !isNaN(Number.parseInt(category))) {
      countSql += ` AND p.category_id = ?`
      countParams.push(Number.parseInt(category))
    }
    if (search && search.trim()) {
      countSql += ` AND (p.name LIKE ? OR p.description LIKE ? OR p.barcode LIKE ?)`
      const searchTerm = `%${search.trim()}%`
      countParams.push(searchTerm, searchTerm, searchTerm)
    }
    if (stockLevel && ["critical", "low", "normal", "high"].includes(stockLevel)) {
      switch (stockLevel) {
        case "critical":
          countSql += ` AND p.stock = 0`
          break
        case "low":
          countSql += ` AND p.stock > 0 AND p.stock <= p.min_stock`
          break
        case "normal":
          countSql += ` AND p.stock > p.min_stock AND p.stock <= (p.min_stock * 2)`
          break
        case "high":
          countSql += ` AND p.stock > (p.min_stock * 2)`
          break
      }
    }
    if (minStock && !isNaN(Number.parseFloat(minStock))) {
      countSql += ` AND p.stock >= ?`
      countParams.push(Number.parseFloat(minStock))
    }
    if (maxStock && !isNaN(Number.parseFloat(maxStock))) {
      countSql += ` AND p.stock <= ?`
      countParams.push(Number.parseFloat(maxStock))
    }
    if (minPrice && !isNaN(Number.parseFloat(minPrice))) {
      countSql += ` AND p.price_level_1 >= ?`
      countParams.push(Number.parseFloat(minPrice))
    }
    if (maxPrice && !isNaN(Number.parseFloat(maxPrice))) {
      countSql += ` AND p.price_level_1 <= ?`
      countParams.push(Number.parseFloat(maxPrice))
    }

    // Ejecutar consultas en paralelo para mejor performance
    const [countResult, products] = await Promise.all([
      executeQuery(countSql, countParams),
      executeQuery(`${sql} LIMIT ${limitNum} OFFSET ${offset}`, params),
    ])

    const total = Number.parseInt(countResult[0].total)
    const totalPages = Math.ceil(total / limitNum)

    res.json({
      success: true,
      data: {
        products,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: totalPages,
        },
      },
    })
  } catch (error) {
    console.error("Error al obtener productos:", error)
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      code: "PRODUCTS_FETCH_ERROR",
    })
  }
}

// Obtener movimientos de stock con paginación optimizada
export const getStockMovements = async (req, res) => {
  try {
    const { product_id, type, start_date, end_date, user_id, page = 1, limit = 25 } = req.query

    let sql = `
      SELECT 
        sm.id,
        sm.product_id,
        sm.type,
        sm.quantity,
        sm.previous_stock,
        sm.new_stock,
        sm.reason,
        sm.created_at,
        sm.user_id,
        p.name as product_name,
        p.image as product_image,
        p.unit_type as product_unit_type,
        u.name as user_name
      FROM stock_movements sm
      LEFT JOIN products p ON sm.product_id = p.id
      LEFT JOIN users u ON sm.user_id = u.id
      WHERE 1=1
    `
    const params = []

    // Filtros optimizados con índices
    if (product_id && !isNaN(Number.parseInt(product_id))) {
      sql += ` AND sm.product_id = ?`
      params.push(Number.parseInt(product_id))
    }

    if (type && ["entrada", "salida", "ajuste"].includes(type)) {
      sql += ` AND sm.type = ?`
      params.push(type)
    }

    if (user_id && !isNaN(Number.parseInt(user_id))) {
      sql += ` AND sm.user_id = ?`
      params.push(Number.parseInt(user_id))
    }

    // Filtros por fecha optimizados
    if (start_date && /^\d{4}-\d{2}-\d{2}$/.test(start_date)) {
      sql += ` AND DATE(sm.created_at) >= ?`
      params.push(start_date)
    }

    if (end_date && /^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
      sql += ` AND DATE(sm.created_at) <= ?`
      params.push(end_date)
    }

    // Ordenamiento optimizado con índice
    sql += ` ORDER BY sm.created_at DESC, sm.id DESC`

    // Paginación
    const pageNum = Math.max(1, Number.parseInt(page) || 1)
    const limitNum = Math.min(100, Math.max(1, Number.parseInt(limit) || 25))
    const offset = (pageNum - 1) * limitNum

    // Consulta de conteo optimizada
    let countSql = `SELECT COUNT(*) as total FROM stock_movements sm WHERE 1=1`
    const countParams = []

    if (product_id && !isNaN(Number.parseInt(product_id))) {
      countSql += ` AND sm.product_id = ?`
      countParams.push(Number.parseInt(product_id))
    }
    if (type && ["entrada", "salida", "ajuste"].includes(type)) {
      countSql += ` AND sm.type = ?`
      countParams.push(type)
    }
    if (user_id && !isNaN(Number.parseInt(user_id))) {
      countSql += ` AND sm.user_id = ?`
      countParams.push(Number.parseInt(user_id))
    }
    if (start_date && /^\d{4}-\d{2}-\d{2}$/.test(start_date)) {
      countSql += ` AND DATE(sm.created_at) >= ?`
      countParams.push(start_date)
    }
    if (end_date && /^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
      countSql += ` AND DATE(sm.created_at) <= ?`
      countParams.push(end_date)
    }

    // Ejecutar consultas en paralelo
    const [countResult, movements] = await Promise.all([
      executeQuery(countSql, countParams),
      executeQuery(`${sql} LIMIT ${limitNum} OFFSET ${offset}`, params),
    ])

    const total = Number.parseInt(countResult[0].total)
    const totalPages = Math.ceil(total / limitNum)

    res.json({
      success: true,
      data: {
        movements,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: totalPages,
        },
      },
    })
  } catch (error) {
    console.error("Error al obtener movimientos:", error)
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      code: "MOVEMENTS_FETCH_ERROR",
    })
  }
}

export const getProductById = async (req, res) => {
  try {
    const { id } = req.params

    if (!id || isNaN(Number.parseInt(id))) {
      return res.status(400).json({
        success: false,
        message: "ID de producto inválido",
        code: "INVALID_PRODUCT_ID",
      })
    }

    const sql = `
      SELECT 
        p.*,
        c.name as category_name,
        c.color as category_color,
        c.icon as category_icon
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.id = ?
    `

    const products = await executeQuery(sql, [Number.parseInt(id)])

    if (products.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Producto no encontrado",
        code: "PRODUCT_NOT_FOUND",
      })
    }

    res.json({
      success: true,
      data: products[0],
    })
  } catch (error) {
    console.error("Error al obtener producto:", error)
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      code: "PRODUCT_FETCH_ERROR",
    })
  }
}

export const createProduct = async (req, res) => {
  try {
    const {
      name,
      description,
      price,
      price_level_1,
      price_level_2,
      price_level_3,
      cost,
      stock,
      min_stock,
      category_id,
      barcode,
      image,
      unit_type,
    } = req.body

    // Validaciones básicas
    if (!name || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "El nombre del producto es requerido",
        code: "NAME_REQUIRED",
      })
    }

    const priceLevel1 = Number.parseFloat(price_level_1 || price || 0)
    const priceLevel2 = Number.parseFloat(price_level_2 || price_level_1 || price || 0)
    const priceLevel3 = Number.parseFloat(price_level_3 || price_level_2 || price_level_1 || price || 0)

    if (priceLevel1 <= 0) {
      return res.status(400).json({
        success: false,
        message: "El precio de venta 1 debe ser un número válido mayor a 0",
        code: "INVALID_PRICE_LEVEL_1",
      })
    }

    if (priceLevel2 <= 0) {
      return res.status(400).json({
        success: false,
        message: "El precio de venta 2 debe ser un número válido mayor a 0",
        code: "INVALID_PRICE_LEVEL_2",
      })
    }

    if (priceLevel3 <= 0) {
      return res.status(400).json({
        success: false,
        message: "El precio de venta 3 debe ser un número válido mayor a 0",
        code: "INVALID_PRICE_LEVEL_3",
      })
    }

    const validUnitTypes = ["unidades", "kg"]
    const productUnitType = unit_type && validUnitTypes.includes(unit_type) ? unit_type : "unidades"

    const productCost = Number.parseFloat(cost) || 0

    let productStock = 0
    if (stock !== undefined && stock !== null && stock !== "") {
      productStock = Number.parseFloat(stock)
      if (isNaN(productStock) || productStock < 0) {
        return res.status(400).json({
          success: false,
          message: "El stock no puede ser negativo",
          code: "INVALID_STOCK",
        })
      }

      if (productUnitType === "unidades" && !Number.isInteger(productStock)) {
        return res.status(400).json({
          success: false,
          message: "Para productos por unidades, el stock debe ser un número entero",
          code: "INVALID_UNIT_STOCK",
        })
      }
    }

    const minStock =
      min_stock !== undefined && min_stock !== null && min_stock !== "" ? Number.parseFloat(min_stock) : 10

    if (isNaN(minStock) || minStock < 0) {
      return res.status(400).json({
        success: false,
        message: "El stock mínimo debe ser un número válido y no puede ser negativo",
        code: "INVALID_MIN_STOCK",
      })
    }

    if (productUnitType === "unidades" && !Number.isInteger(minStock)) {
      return res.status(400).json({
        success: false,
        message: "Para productos por unidades, el stock mínimo debe ser un número entero",
        code: "INVALID_MIN_UNIT_STOCK",
      })
    }

    const productCategoryId = category_id && !isNaN(Number.parseInt(category_id)) ? Number.parseInt(category_id) : null

    if (productCost < 0) {
      return res.status(400).json({
        success: false,
        message: "El costo no puede ser negativo",
        code: "INVALID_COST",
      })
    }

    if (barcode && barcode.trim()) {
      const existingProduct = await executeQuery("SELECT id FROM products WHERE barcode = ?", [barcode.trim()])
      if (existingProduct.length > 0) {
        return res.status(400).json({
          success: false,
          message: "Ya existe un producto con este código de barras",
          code: "BARCODE_EXISTS",
        })
      }
    }

    // Verificar categoría
    if (productCategoryId) {
      const categoryExists = await executeQuery("SELECT id FROM categories WHERE id = ? AND active = true", [
        productCategoryId,
      ])
      if (categoryExists.length === 0) {
        return res.status(400).json({
          success: false,
          message: "La categoría especificada no existe o no está activa",
          code: "CATEGORY_NOT_FOUND",
        })
      }
    }

    const insertSql = `
      INSERT INTO products (
        name, description, price, price_level_1, price_level_2, price_level_3, 
        cost, stock, min_stock, category_id, 
        barcode, image, unit_type, active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `

    const insertParams = [
      name.trim(),
      description?.trim() || null,
      priceLevel1, // Keep price field for backward compatibility
      priceLevel1,
      priceLevel2,
      priceLevel3,
      productCost,
      productStock,
      minStock,
      productCategoryId,
      barcode?.trim() || null,
      image?.trim() || null,
      productUnitType,
      true,
    ]

    const result = await executeQuery(insertSql, insertParams)

    // Si hay stock inicial, crear movimiento
    if (productStock > 0) {
      const movementSql = `
        INSERT INTO stock_movements (product_id, type, quantity, previous_stock, new_stock, reason, user_id)
        VALUES (?, 'entrada', ?, 0, ?, 'Stock inicial', ?)
      `
      await executeQuery(movementSql, [result.insertId, productStock, productStock, req.user?.id || null])
    }

    // Obtener el producto creado
    const newProduct = await executeQuery(
      `SELECT 
        p.*,
        c.name as category_name,
        c.color as category_color,
        c.icon as category_icon
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.id = ?`,
      [result.insertId],
    )

    res.status(201).json({
      success: true,
      message: "Producto creado correctamente",
      data: newProduct[0],
    })
  } catch (error) {
    console.error("Error al crear producto:", error)
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      code: "PRODUCT_CREATE_ERROR",
    })
  }
}

export const updateProduct = async (req, res) => {
  try {
    const { id } = req.params
    const {
      name,
      description,
      price,
      price_level_1,
      price_level_2,
      price_level_3,
      cost,
      min_stock,
      category_id,
      barcode,
      image,
      active,
      unit_type,
    } = req.body

    if (!id || isNaN(Number.parseInt(id))) {
      return res.status(400).json({
        success: false,
        message: "ID de producto inválido",
        code: "INVALID_PRODUCT_ID",
      })
    }

    const existingProduct = await executeQuery("SELECT * FROM products WHERE id = ?", [Number.parseInt(id)])
    if (existingProduct.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Producto no encontrado",
        code: "PRODUCT_NOT_FOUND",
      })
    }

    if (!name || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "El nombre del producto es requerido",
        code: "NAME_REQUIRED",
      })
    }

    const currentProduct = existingProduct[0]
    const priceLevel1 =
      price_level_1 !== undefined
        ? Number.parseFloat(price_level_1)
        : price !== undefined
          ? Number.parseFloat(price)
          : currentProduct.price_level_1
    const priceLevel2 = price_level_2 !== undefined ? Number.parseFloat(price_level_2) : currentProduct.price_level_2
    const priceLevel3 = price_level_3 !== undefined ? Number.parseFloat(price_level_3) : currentProduct.price_level_3

    if (isNaN(priceLevel1) || priceLevel1 <= 0) {
      return res.status(400).json({
        success: false,
        message: "El precio de venta 1 debe ser un número válido mayor a 0",
        code: "INVALID_PRICE_LEVEL_1",
      })
    }

    if (isNaN(priceLevel2) || priceLevel2 <= 0) {
      return res.status(400).json({
        success: false,
        message: "El precio de venta 2 debe ser un número válido mayor a 0",
        code: "INVALID_PRICE_LEVEL_2",
      })
    }

    if (isNaN(priceLevel3) || priceLevel3 <= 0) {
      return res.status(400).json({
        success: false,
        message: "El precio de venta 3 debe ser un número válido mayor a 0",
        code: "INVALID_PRICE_LEVEL_3",
      })
    }

    const validUnitTypes = ["unidades", "kg"]
    const productUnitType =
      unit_type && validUnitTypes.includes(unit_type) ? unit_type : existingProduct[0].unit_type || "unidades"

    const productCost = Number.parseFloat(cost) || 0

    let minStock = existingProduct[0].min_stock

    if (min_stock !== undefined) {
      if (min_stock === null || min_stock === "") {
        minStock = 10
      } else {
        minStock = Number.parseFloat(min_stock)
        if (isNaN(minStock) || minStock < 0) {
          return res.status(400).json({
            success: false,
            message: "El stock mínimo debe ser un número válido y no puede ser negativo",
            code: "INVALID_MIN_STOCK",
          })
        }

        if (productUnitType === "unidades" && !Number.isInteger(minStock)) {
          return res.status(400).json({
            success: false,
            message: "Para productos por unidades, el stock mínimo debe ser un número entero",
            code: "INVALID_MIN_UNIT_STOCK",
          })
        }
      }
    }

    const productCategoryId = category_id && !isNaN(Number.parseInt(category_id)) ? Number.parseInt(category_id) : null
    const productActive = active !== undefined ? Boolean(active) : true

    if (productCost < 0) {
      return res.status(400).json({
        success: false,
        message: "El costo no puede ser negativo",
        code: "INVALID_COST",
      })
    }

    if (barcode && barcode.trim()) {
      const duplicateBarcode = await executeQuery("SELECT id FROM products WHERE barcode = ? AND id != ?", [
        barcode.trim(),
        Number.parseInt(id),
      ])
      if (duplicateBarcode.length > 0) {
        return res.status(400).json({
          success: false,
          message: "Ya existe otro producto con este código de barras",
          code: "BARCODE_EXISTS",
        })
      }
    }

    if (productCategoryId) {
      const categoryExists = await executeQuery("SELECT id FROM categories WHERE id = ? AND active = true", [
        productCategoryId,
      ])
      if (categoryExists.length === 0) {
        return res.status(400).json({
          success: false,
          message: "La categoría especificada no existe o no está activa",
          code: "CATEGORY_NOT_FOUND",
        })
      }
    }

    const updateSql = `
      UPDATE products 
      SET name = ?, description = ?, price = ?, price_level_1 = ?, price_level_2 = ?, price_level_3 = ?, 
          cost = ?, min_stock = ?, category_id = ?, barcode = ?, image = ?, unit_type = ?, active = ?, updated_at = NOW()
      WHERE id = ?
    `

    const updateParams = [
      name.trim(),
      description?.trim() || null,
      priceLevel1, // Keep price field for backward compatibility
      priceLevel1,
      priceLevel2,
      priceLevel3,
      productCost,
      minStock,
      productCategoryId,
      barcode?.trim() || null,
      image?.trim() || null,
      productUnitType,
      productActive,
      Number.parseInt(id),
    ]

    await executeQuery(updateSql, updateParams)

    const updatedProduct = await executeQuery(
      `SELECT 
        p.*,
        c.name as category_name,
        c.color as category_color,
        c.icon as category_icon
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.id = ?`,
      [Number.parseInt(id)],
    )

    res.json({
      success: true,
      message: "Producto actualizado correctamente",
      data: updatedProduct[0],
    })
  } catch (error) {
    console.error("Error al actualizar producto:", error)
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      code: "PRODUCT_UPDATE_ERROR",
    })
  }
}

export const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params

    if (!id || isNaN(Number.parseInt(id))) {
      return res.status(400).json({
        success: false,
        message: "ID de producto inválido",
        code: "INVALID_PRODUCT_ID",
      })
    }

    const existingProduct = await executeQuery("SELECT * FROM products WHERE id = ?", [Number.parseInt(id)])
    if (existingProduct.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Producto no encontrado",
        code: "PRODUCT_NOT_FOUND",
      })
    }

    const salesCount = await executeQuery("SELECT COUNT(*) as count FROM sale_items WHERE product_id = ?", [
      Number.parseInt(id),
    ])

    if (salesCount[0].count > 0) {
      // Producto con ventas: solo desactivar para mantener integridad referencial
      await executeQuery("UPDATE products SET active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [
        Number.parseInt(id),
      ])

      res.json({
        success: true,
        message: "Producto desactivado correctamente (tiene ventas asociadas)",
        action: "deactivated",
      })
    } else {
      // Producto sin ventas: eliminar completamente
      // Primero eliminar movimientos de stock relacionados
      await executeQuery("DELETE FROM stock_movements WHERE product_id = ?", [Number.parseInt(id)])

      // Luego eliminar el producto
      await executeQuery("DELETE FROM products WHERE id = ?", [Number.parseInt(id)])

      res.json({
        success: true,
        message: "Producto eliminado completamente",
        action: "deleted",
      })
    }
  } catch (error) {
    console.error("Error al eliminar producto:", error)
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      code: "PRODUCT_DELETE_ERROR",
    })
  }
}

export const createStockMovement = async (req, res) => {
  try {
    const { product_id, type, quantity, reason } = req.body

    if (!product_id || isNaN(Number.parseInt(product_id))) {
      return res.status(400).json({
        success: false,
        message: "ID de producto inválido",
        code: "INVALID_PRODUCT_ID",
      })
    }

    if (!type || !["entrada", "salida", "ajuste"].includes(type)) {
      return res.status(400).json({
        success: false,
        message: "Tipo de movimiento inválido. Debe ser: entrada, salida o ajuste",
        code: "INVALID_MOVEMENT_TYPE",
      })
    }

    if (!quantity || isNaN(Number.parseFloat(quantity))) {
      return res.status(400).json({
        success: false,
        message: "Cantidad inválida",
        code: "INVALID_QUANTITY",
      })
    }

    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "La razón del movimiento es requerida",
        code: "REASON_REQUIRED",
      })
    }

    const productId = Number.parseInt(product_id)
    const movementQuantity = Number.parseFloat(quantity)

    const product = await executeQuery("SELECT * FROM products WHERE id = ? AND active = TRUE", [productId])
    if (product.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Producto no encontrado o inactivo",
        code: "PRODUCT_NOT_FOUND",
      })
    }

    const currentProduct = product[0]

    if (currentProduct.unit_type === "unidades" && !Number.isInteger(movementQuantity)) {
      return res.status(400).json({
        success: false,
        message: "Para productos por unidades, la cantidad debe ser un número entero",
        code: "INVALID_UNIT_QUANTITY",
      })
    }

    const previousStock = Number.parseFloat(currentProduct.stock)
    let newStock = 0
    let stockChange = 0

    switch (type) {
      case "entrada":
        if (movementQuantity <= 0) {
          return res.status(400).json({
            success: false,
            message: "La cantidad para entrada debe ser mayor a 0",
            code: "INVALID_ENTRY_QUANTITY",
          })
        }
        stockChange = Math.abs(movementQuantity)
        newStock = previousStock + stockChange
        break

      case "salida":
        if (movementQuantity <= 0) {
          return res.status(400).json({
            success: false,
            message: "La cantidad para salida debe ser mayor a 0",
            code: "INVALID_EXIT_QUANTITY",
          })
        }
        stockChange = -Math.abs(movementQuantity)
        newStock = previousStock + stockChange

        if (newStock < 0) {
          return res.status(400).json({
            success: false,
            message: `No hay suficiente stock. Stock actual: ${previousStock}, cantidad solicitada: ${Math.abs(movementQuantity)}`,
            code: "INSUFFICIENT_STOCK",
          })
        }
        break

      case "ajuste":
        if (movementQuantity < 0) {
          return res.status(400).json({
            success: false,
            message: "El stock no puede ser negativo",
            code: "NEGATIVE_STOCK",
          })
        }
        newStock = Math.abs(movementQuantity)
        stockChange = newStock - previousStock
        break
    }

    const queries = []

    queries.push({
      query: `
        INSERT INTO stock_movements (product_id, type, quantity, previous_stock, new_stock, reason, user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      params: [productId, type, stockChange, previousStock, newStock, reason.trim(), req.user?.id || null],
    })

    queries.push({
      query: `UPDATE products SET stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      params: [newStock, productId],
    })

    const results = await executeTransaction(queries)
    const movementId = results[0].insertId

    const newMovement = await executeQuery(
      `SELECT 
        sm.*,
        p.name as product_name,
        p.image as product_image,
        p.unit_type as product_unit_type,
        u.name as user_name
      FROM stock_movements sm
      LEFT JOIN products p ON sm.product_id = p.id
      LEFT JOIN users u ON sm.user_id = u.id
      WHERE sm.id = ?`,
      [movementId],
    )

    res.status(201).json({
      success: true,
      message: "Movimiento de stock registrado correctamente",
      data: newMovement[0],
    })
  } catch (error) {
    console.error("Error al crear movimiento:", error)
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      code: "MOVEMENT_CREATE_ERROR",
    })
  }
}

export const getStockAlerts = async (req, res) => {
  try {
    const sql = `
      SELECT 
        p.id,
        p.name,
        p.stock,
        COALESCE(p.min_stock, 10) as min_stock,
        p.unit_type,
        c.name as category_name,
        CASE 
          WHEN p.stock = 0 THEN 'critical'
          WHEN p.stock <= COALESCE(p.min_stock, 10) THEN 'warning'
          WHEN p.stock <= (COALESCE(p.min_stock, 10) * 1.5) THEN 'low'
          ELSE 'normal'
        END as level
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.active = TRUE 
        AND p.stock <= COALESCE(p.min_stock, 10)
        AND COALESCE(p.min_stock, 10) > 0
      ORDER BY 
        CASE 
          WHEN p.stock = 0 THEN 1
          WHEN p.stock <= COALESCE(p.min_stock, 10) THEN 2
          WHEN p.stock <= (COALESCE(p.min_stock, 10) * 1.5) THEN 3
          ELSE 4
        END,
        p.stock ASC, 
        p.name ASC
    `

    const alerts = await executeQuery(sql)

    res.json({
      success: true,
      data: alerts,
    })
  } catch (error) {
    console.error("Error al obtener alertas:", error)
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      code: "ALERTS_FETCH_ERROR",
    })
  }
}

export const getStockStats = async (req, res) => {
  try {
    const generalStats = await executeQuery(`SELECT 
      COUNT(*) as total_products,
      SUM(CASE WHEN active = TRUE THEN 1 ELSE 0 END) as active_products,
      SUM(CASE WHEN active = TRUE AND stock <= min_stock THEN 1 ELSE 0 END) as low_stock,
      SUM(CASE WHEN active = TRUE AND stock = 0 THEN 1 ELSE 0 END) as out_of_stock,
      SUM(CASE WHEN active = TRUE AND unit_type = 'unidades' THEN 1 ELSE 0 END) as unit_products,
      SUM(CASE WHEN active = TRUE AND unit_type = 'kg' THEN 1 ELSE 0 END) as kg_products,
      COALESCE(SUM(CASE WHEN active = TRUE THEN stock * price ELSE 0 END), 0) as total_inventory_value
    FROM products`)

    const monthlyMovements = await executeQuery(`SELECT 
      type,
      COUNT(*) as count,
      SUM(ABS(quantity)) as total_quantity
    FROM stock_movements 
    WHERE MONTH(created_at) = MONTH(CURRENT_DATE()) 
      AND YEAR(created_at) = YEAR(CURRENT_DATE())
    GROUP BY type`)

    const lowStockProducts = await executeQuery(`SELECT 
      p.id,
      p.name,
      p.stock,
      COALESCE(p.min_stock, 10) as min_stock,
      p.unit_type,
      c.name as category_name,
      CASE 
        WHEN p.stock = 0 THEN 'critical'
        WHEN p.stock <= COALESCE(p.min_stock, 10) THEN 'warning'
        WHEN p.stock <= (COALESCE(p.min_stock, 10) * 1.5) THEN 'low'
        ELSE 'normal'
      END as level
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.active = TRUE 
      AND p.stock <= COALESCE(p.min_stock, 10)
      AND COALESCE(p.min_stock, 10) > 0
    ORDER BY 
      CASE 
        WHEN p.stock = 0 THEN 1
        WHEN p.stock <= COALESCE(p.min_stock, 10) THEN 2
        WHEN p.stock <= (COALESCE(p.min_stock, 10) * 1.5) THEN 3
        ELSE 4
      END,
      p.stock ASC
    LIMIT 10`)

    res.json({
      success: true,
      data: {
        general: generalStats[0],
        monthly_movements: monthlyMovements,
        low_stock_products: lowStockProducts,
      },
    })
  } catch (error) {
    console.error("Error al obtener estadísticas:", error)
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      code: "STATS_FETCH_ERROR",
    })
  }
}

export const getProductPriceByLevel = async (req, res) => {
  try {
    const { id } = req.params
    const { level = 1 } = req.query

    if (!id || isNaN(Number.parseInt(id))) {
      return res.status(400).json({
        success: false,
        message: "ID de producto inválido",
        code: "INVALID_PRODUCT_ID",
      })
    }

    const priceLevel = Number.parseInt(level)
    if (![1, 2, 3].includes(priceLevel)) {
      return res.status(400).json({
        success: false,
        message: "Nivel de precio inválido. Debe ser 1, 2 o 3",
        code: "INVALID_PRICE_LEVEL",
      })
    }

    const sql = `
      SELECT 
        id,
        name,
        price_level_1,
        price_level_2,
        price_level_3,
        CASE 
          WHEN ? = 1 THEN price_level_1
          WHEN ? = 2 THEN price_level_2
          WHEN ? = 3 THEN price_level_3
          ELSE price_level_1
        END as selected_price,
        unit_type,
        stock
      FROM products 
      WHERE id = ? AND active = TRUE
    `

    const products = await executeQuery(sql, [priceLevel, priceLevel, priceLevel, Number.parseInt(id)])

    if (products.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Producto no encontrado o inactivo",
        code: "PRODUCT_NOT_FOUND",
      })
    }

    res.json({
      success: true,
      data: products[0],
    })
  } catch (error) {
    console.error("Error al obtener precio por nivel:", error)
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      code: "PRICE_LEVEL_FETCH_ERROR",
    })
  }
}

// NUEVO: Descargar plantilla Excel para importar productos
export const downloadExcelTemplate = async (req, res) => {
  try {
    // Create workbook
    const wb = xlsx.utils.book_new()

    // Define template headers
    const headers = [
      "nombre",
      "descripcion",
      "precio_nivel_1",
      "precio_nivel_2",
      "precio_nivel_3",
      "costo",
      "stock",
      "stock_minimo",
      "tipo_unidad",
      "categoria",
      "codigo_barras",
      "imagen_url",
    ]

    // Create example data
    const exampleData = [
      [
        "Coca Cola 500ml",
        "Gaseosa Coca Cola 500ml",
        350.0,
        320.0,
        300.0,
        200.0,
        50,
        10,
        "unidades",
        "Bebidas",
        "7790001234567",
        "https://ejemplo.com/imagen.jpg",
      ],
      [
        "Carne Molida",
        "Carne molida especial",
        2800.0,
        2700.0,
        2600.0,
        2200.0,
        15.5,
        2.0,
        "kg",
        "Carnes",
        "7790009876543",
        "",
      ],
    ]

    // Create worksheet data
    const wsData = [headers, ...exampleData]

    // Create worksheet
    const ws = xlsx.utils.aoa_to_sheet(wsData)

    // Set column widths
    ws["!cols"] = [
      { wch: 25 }, // nombre
      { wch: 40 }, // descripcion
      { wch: 15 }, // precio_nivel_1
      { wch: 15 }, // precio_nivel_2
      { wch: 15 }, // precio_nivel_3
      { wch: 12 }, // costo
      { wch: 10 }, // stock
      { wch: 15 }, // stock_minimo
      { wch: 15 }, // tipo_unidad
      { wch: 20 }, // categoria
      { wch: 20 }, // codigo_barras
      { wch: 40 }, // imagen_url
    ]

    // Add instructions sheet
    const instructionsData = [
      ["INSTRUCCIONES PARA IMPORTAR PRODUCTOS"],
      [""],
      ["Campos requeridos:"],
      ["- nombre: Nombre del producto (obligatorio)"],
      ["- precio_nivel_1: Precio de venta nivel 1 (obligatorio, debe ser mayor a 0)"],
      [""],
      ["Campos opcionales:"],
      ["- descripcion: Descripción del producto"],
      ["- precio_nivel_2: Precio de venta nivel 2 (si no se especifica, se usa precio_nivel_1)"],
      ["- precio_nivel_3: Precio de venta nivel 3 (si no se especifica, se usa precio_nivel_2)"],
      ["- costo: Costo del producto (por defecto 0)"],
      ["- stock: Stock inicial (por defecto 0)"],
      ["- stock_minimo: Stock mínimo para alertas (por defecto 10)"],
      ["- tipo_unidad: 'unidades' o 'kg' (por defecto 'unidades')"],
      ["- categoria: Nombre de la categoría (se creará si no existe)"],
      ["- codigo_barras: Código de barras único"],
      ["- imagen_url: URL de la imagen del producto"],
      [""],
      ["Notas importantes:"],
      ["- Para productos por 'kg', el stock puede tener decimales (ej: 15.5)"],
      ["- Para productos por 'unidades', el stock debe ser un número entero"],
      ["- Los códigos de barras duplicados serán omitidos"],
      ["- Las categorías se crearán automáticamente si no existen"],
      ["- El stock inicial creará un movimiento de entrada automático"],
    ]

    const wsInstructions = xlsx.utils.aoa_to_sheet(instructionsData)
    wsInstructions["!cols"] = [{ wch: 80 }]

    // Add sheets to workbook
    xlsx.utils.book_append_sheet(wb, ws, "Productos")
    xlsx.utils.book_append_sheet(wb, wsInstructions, "Instrucciones")

    // Generate buffer
    const buffer = xlsx.write(wb, { type: "buffer", bookType: "xlsx" })

    // Set headers
    res.setHeader("Content-Disposition", "attachment; filename=plantilla_productos.xlsx")
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")

    // Send file
    res.send(buffer)
  } catch (error) {
    console.error("Error generating template:", error)
    res.status(500).json({
      success: false,
      message: "Error al generar la plantilla",
      code: "TEMPLATE_GENERATION_ERROR",
    })
  }
}

// NUEVO: Importar productos desde archivo Excel
export const importProductsFromExcel = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No se ha enviado ningún archivo",
        code: "NO_FILE",
      })
    }

    // Read Excel file
    const workbook = xlsx.read(req.file.buffer, { type: "buffer" })
    const sheetName = workbook.SheetNames[0]
    const worksheet = workbook.Sheets[sheetName]

    // Convert to JSON
    const data = xlsx.utils.sheet_to_json(worksheet)

    if (data.length === 0) {
      return res.status(400).json({
        success: false,
        message: "El archivo Excel está vacío",
        code: "EMPTY_FILE",
      })
    }

    const results = {
      total: data.length,
      success: 0,
      errors: 0,
      skipped: 0,
      details: [],
    }

    // Get all categories for mapping
    const existingCategories = await executeQuery("SELECT id, name FROM categories WHERE active = TRUE")
    const categoryMap = new Map(existingCategories.map((c) => [c.name.toLowerCase(), c.id]))

    // Get all existing barcodes
    const existingBarcodes = await executeQuery("SELECT barcode FROM products WHERE barcode IS NOT NULL")
    const barcodeSet = new Set(existingBarcodes.map((p) => p.barcode))

    // Process each row
    for (let i = 0; i < data.length; i++) {
      const row = data[i]
      const rowNumber = i + 2 // +2 because Excel rows start at 1 and we have a header

      try {
        // Validate required fields
        if (!row.nombre || !row.nombre.trim()) {
          results.errors++
          results.details.push({
            row: rowNumber,
            status: "error",
            message: "El nombre del producto es requerido",
            data: row,
          })
          continue
        }

        const priceLevel1 = Number.parseFloat(row.precio_nivel_1)
        if (isNaN(priceLevel1) || priceLevel1 <= 0) {
          results.errors++
          results.details.push({
            row: rowNumber,
            status: "error",
            message: "El precio_nivel_1 debe ser un número mayor a 0",
            data: row,
          })
          continue
        }

        // Check for duplicate barcode
        if (row.codigo_barras && row.codigo_barras.trim()) {
          const barcode = row.codigo_barras.trim()
          if (barcodeSet.has(barcode)) {
            results.skipped++
            results.details.push({
              row: rowNumber,
              status: "skipped",
              message: `Código de barras duplicado: ${barcode}`,
              data: row,
            })
            continue
          }
          barcodeSet.add(barcode)
        }

        // Process category
        let categoryId = null
        if (row.categoria && row.categoria.trim()) {
          const categoryName = row.categoria.trim()
          const categoryKey = categoryName.toLowerCase()

          if (categoryMap.has(categoryKey)) {
            categoryId = categoryMap.get(categoryKey)
          } else {
            // Create new category
            const newCategory = await executeQuery(
              "INSERT INTO categories (name, active, created_at, updated_at) VALUES (?, TRUE, NOW(), NOW())",
              [categoryName],
            )
            categoryId = newCategory.insertId
            categoryMap.set(categoryKey, categoryId)
          }
        }

        // Process prices
        const priceLevel2 = row.precio_nivel_2 ? Number.parseFloat(row.precio_nivel_2) : priceLevel1
        const priceLevel3 = row.precio_nivel_3 ? Number.parseFloat(row.precio_nivel_3) : priceLevel2

        // Process unit type
        const validUnitTypes = ["unidades", "kg"]
        const unitType =
          row.tipo_unidad && validUnitTypes.includes(row.tipo_unidad.toLowerCase())
            ? row.tipo_unidad.toLowerCase()
            : "unidades"

        // Process stock
        let stock = 0
        if (row.stock !== undefined && row.stock !== null && row.stock !== "") {
          stock = Number.parseFloat(row.stock)
          if (isNaN(stock) || stock < 0) {
            results.errors++
            results.details.push({
              row: rowNumber,
              status: "error",
              message: "El stock debe ser un número válido mayor o igual a 0",
              data: row,
            })
            continue
          }

          // Validate integer for units
          if (unitType === "unidades" && !Number.isInteger(stock)) {
            results.errors++
            results.details.push({
              row: rowNumber,
              status: "error",
              message: "Para productos por unidades, el stock debe ser un número entero",
              data: row,
            })
            continue
          }
        }

        // Process min stock
        let minStock = 10
        if (row.stock_minimo !== undefined && row.stock_minimo !== null && row.stock_minimo !== "") {
          minStock = Number.parseFloat(row.stock_minimo)
          if (isNaN(minStock) || minStock < 0) {
            minStock = 10
          }
          if (unitType === "unidades" && !Number.isInteger(minStock)) {
            minStock = Math.floor(minStock)
          }
        }

        // Process cost
        const cost = row.costo ? Number.parseFloat(row.costo) : 0

        // Insert product
        const insertSql = `
          INSERT INTO products (
            name, description, price, price_level_1, price_level_2, price_level_3,
            cost, stock, min_stock, category_id, barcode, image, unit_type, active, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, NOW(), NOW())
        `

        const insertParams = [
          row.nombre.trim(),
          row.descripcion?.trim() || null,
          priceLevel1,
          priceLevel1,
          priceLevel2,
          priceLevel3,
          cost,
          stock,
          minStock,
          categoryId,
          row.codigo_barras?.trim() || null,
          row.imagen_url?.trim() || null,
          unitType,
        ]

        const result = await executeQuery(insertSql, insertParams)

        // Create stock movement if initial stock > 0
        if (stock > 0) {
          await executeQuery(
            `INSERT INTO stock_movements (product_id, type, quantity, previous_stock, new_stock, reason, user_id)
             VALUES (?, 'entrada', ?, 0, ?, 'Importación desde Excel', ?)`,
            [result.insertId, stock, stock, req.user?.id || null],
          )
        }

        results.success++
        results.details.push({
          row: rowNumber,
          status: "success",
          message: `Producto "${row.nombre}" importado correctamente`,
          data: row,
        })
      } catch (error) {
        console.error(`Error processing row ${rowNumber}:`, error)
        results.errors++
        results.details.push({
          row: rowNumber,
          status: "error",
          message: error.message || "Error al procesar el producto",
          data: row,
        })
      }
    }

    res.json({
      success: true,
      message: `Importación completada: ${results.success} exitosos, ${results.errors} errores, ${results.skipped} omitidos`,
      data: results,
    })
  } catch (error) {
    console.error("Error importing products:", error)
    res.status(500).json({
      success: false,
      message: "Error al importar productos",
      code: "IMPORT_ERROR",
      error: error.message,
    })
  }
}
