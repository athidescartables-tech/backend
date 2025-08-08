import { executeQuery, executeTransaction } from "../config/database.js"

// NUEVO: Obtener los 10 productos más vendidos para la interfaz de ventas
export const getTopSellingProducts = async (req, res) => {
  try {
    const { limit = 10 } = req.query

    // Validar límite
    const limitNum = Math.min(50, Math.max(5, Number.parseInt(limit) || 10))

    const sql = `
      SELECT 
        p.id,
        p.name,
        p.description,
        p.price,
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
      GROUP BY p.id, p.name, p.description, p.price, p.cost, p.stock, p.min_stock, p.unit_type, p.category_id, p.barcode, p.image, p.active, p.created_at, p.updated_at, c.name, c.color, c.icon
      ORDER BY total_sold DESC, sales_count DESC, p.name ASC
      LIMIT ?
    `

    const topProducts = await executeQuery(sql, [limitNum])

    res.json({
      success: true,
      data: {
        products: topProducts,
        count: topProducts.length,
        limit: limitNum,
      },
    })
  } catch (error) {
    console.error("Error al obtener productos más vendidos:", error)
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      code: "TOP_PRODUCTS_FETCH_ERROR",
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

    // Filtro por rango de precios
    if (minPrice && !isNaN(Number.parseFloat(minPrice))) {
      sql += ` AND p.price >= ?`
      params.push(Number.parseFloat(minPrice))
    }
    if (maxPrice && !isNaN(Number.parseFloat(maxPrice))) {
      sql += ` AND p.price <= ?`
      params.push(Number.parseFloat(maxPrice))
    }

    sql += ` GROUP BY p.id, p.name, p.description, p.price, p.cost, p.stock, p.min_stock, p.unit_type, p.category_id, p.barcode, p.image, p.active, p.created_at, p.updated_at, c.name, c.color, c.icon`
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
      countSql += ` AND p.price >= ?`
      countParams.push(Number.parseFloat(minPrice))
    }
    if (maxPrice && !isNaN(Number.parseFloat(maxPrice))) {
      countSql += ` AND p.price <= ?`
      countParams.push(Number.parseFloat(maxPrice))
    }

    // Ejecutar consultas en paralelo para mejor performance
    const [countResult, products] = await Promise.all([
      executeQuery(countSql, countParams),
      executeQuery(sql + ` LIMIT ? OFFSET ?`, [...params, limitNum, offset]),
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
      executeQuery(sql + ` LIMIT ? OFFSET ?`, [...params, limitNum, offset]),
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
    const { name, description, price, cost, stock, min_stock, category_id, barcode, image, unit_type } = req.body

    // Validaciones básicas
    if (!name || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "El nombre del producto es requerido",
        code: "NAME_REQUIRED",
      })
    }

    if (!price || isNaN(Number.parseFloat(price)) || Number.parseFloat(price) <= 0) {
      return res.status(400).json({
        success: false,
        message: "El precio debe ser un número válido mayor a 0",
        code: "INVALID_PRICE",
      })
    }

    const validUnitTypes = ["unidades", "kg"]
    const productUnitType = unit_type && validUnitTypes.includes(unit_type) ? unit_type : "unidades"

    const productPrice = Number.parseFloat(price)
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

    let productMinStock = productUnitType === "kg" ? 1.0 : 10
    if (min_stock !== undefined && min_stock !== null && min_stock !== "") {
      productMinStock = Number.parseFloat(min_stock)
      if (isNaN(productMinStock) || productMinStock < 0) {
        return res.status(400).json({
          success: false,
          message: "El stock mínimo no puede ser negativo",
          code: "INVALID_MIN_STOCK",
        })
      }

      if (productUnitType === "unidades" && !Number.isInteger(productMinStock)) {
        return res.status(400).json({
          success: false,
          message: "Para productos por unidades, el stock mínimo debe ser un número entero",
          code: "INVALID_UNIT_MIN_STOCK",
        })
      }
    }

    const productCategoryId = category_id && !isNaN(Number.parseInt(category_id)) ? Number.parseInt(category_id) : null

    if (productCost < 0) {
      return res.status(400).json({
        success: false,
        message: "El costo no puede ser negativo",
        code: "INVALID_COST",
      })
    }

    // Verificar código de barras único
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

    const sql = `
      INSERT INTO products (name, description, price, cost, stock, min_stock, category_id, barcode, image, unit_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `

    const result = await executeQuery(sql, [
      name.trim(),
      description?.trim() || null,
      productPrice,
      productCost,
      productStock,
      productMinStock,
      productCategoryId,
      barcode?.trim() || null,
      image?.trim() || null,
      productUnitType,
    ])

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
      `
      SELECT 
        p.*,
        c.name as category_name,
        c.color as category_color,
        c.icon as category_icon
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.id = ?
    `,
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
    const { name, description, price, cost, min_stock, category_id, barcode, image, active, unit_type } = req.body

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

    if (!price || isNaN(Number.parseFloat(price)) || Number.parseFloat(price) <= 0) {
      return res.status(400).json({
        success: false,
        message: "El precio debe ser un número válido mayor a 0",
        code: "INVALID_PRICE",
      })
    }

    const validUnitTypes = ["unidades", "kg"]
    const productUnitType =
      unit_type && validUnitTypes.includes(unit_type) ? unit_type : existingProduct[0].unit_type || "unidades"

    const productPrice = Number.parseFloat(price)
    const productCost = Number.parseFloat(cost) || 0

    let productMinStock = productUnitType === "kg" ? 1.0 : 10
    if (min_stock !== undefined && min_stock !== null && min_stock !== "") {
      productMinStock = Number.parseFloat(min_stock)
      if (isNaN(productMinStock) || productMinStock < 0) {
        return res.status(400).json({
          success: false,
          message: "El stock mínimo no puede ser negativo",
          code: "INVALID_MIN_STOCK",
        })
      }

      if (productUnitType === "unidades" && !Number.isInteger(productMinStock)) {
        return res.status(400).json({
          success: false,
          message: "Para productos por unidades, el stock mínimo debe ser un número entero",
          code: "INVALID_UNIT_MIN_STOCK",
        })
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

    const sql = `
      UPDATE products 
      SET name = ?, description = ?, price = ?, cost = ?, min_stock = ?, 
          category_id = ?, barcode = ?, image = ?, active = ?, unit_type = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `

    await executeQuery(sql, [
      name.trim(),
      description?.trim() || null,
      productPrice,
      productCost,
      productMinStock,
      productCategoryId,
      barcode?.trim() || null,
      image?.trim() || null,
      productActive,
      productUnitType,
      Number.parseInt(id),
    ])

    const updatedProduct = await executeQuery(
      `
      SELECT 
        p.*,
        c.name as category_name,
        c.color as category_color,
        c.icon as category_icon
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.id = ?
    `,
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

    await executeQuery("UPDATE products SET active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [
      Number.parseInt(id),
    ])

    res.json({
      success: true,
      message:
        salesCount[0].count > 0
          ? "Producto desactivado correctamente (tiene ventas asociadas)"
          : "Producto eliminado correctamente",
    })
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
      `
      SELECT 
        sm.*,
        p.name as product_name,
        p.image as product_image,
        p.unit_type as product_unit_type,
        u.name as user_name
      FROM stock_movements sm
      LEFT JOIN products p ON sm.product_id = p.id
      LEFT JOIN users u ON sm.user_id = u.id
      WHERE sm.id = ?
    `,
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
        p.min_stock,
        p.unit_type,
        c.name as category_name,
        CASE 
          WHEN p.stock = 0 THEN 'critical'
          WHEN p.stock <= p.min_stock THEN 'critical'
          WHEN p.stock <= (p.min_stock * 1.5) THEN 'warning'
          ELSE 'normal'
        END as level
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.active = TRUE AND p.stock <= p.min_stock
      ORDER BY 
        CASE 
          WHEN p.stock = 0 THEN 1
          WHEN p.stock <= p.min_stock THEN 2
          WHEN p.stock <= (p.min_stock * 1.5) THEN 3
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
    const generalStats = await executeQuery(`
      SELECT 
        COUNT(*) as total_products,
        SUM(CASE WHEN active = TRUE THEN 1 ELSE 0 END) as active_products,
        SUM(CASE WHEN active = TRUE AND stock <= min_stock THEN 1 ELSE 0 END) as low_stock,
        SUM(CASE WHEN active = TRUE AND stock = 0 THEN 1 ELSE 0 END) as out_of_stock,
        SUM(CASE WHEN active = TRUE AND unit_type = 'unidades' THEN 1 ELSE 0 END) as unit_products,
        SUM(CASE WHEN active = TRUE AND unit_type = 'kg' THEN 1 ELSE 0 END) as kg_products,
        COALESCE(SUM(CASE WHEN active = TRUE THEN stock * price ELSE 0 END), 0) as total_inventory_value
      FROM products
    `)

    const monthlyMovements = await executeQuery(`
      SELECT 
        type,
        COUNT(*) as count,
        SUM(ABS(quantity)) as total_quantity
      FROM stock_movements 
      WHERE MONTH(created_at) = MONTH(CURRENT_DATE()) 
        AND YEAR(created_at) = YEAR(CURRENT_DATE())
      GROUP BY type
    `)

    const lowStockProducts = await executeQuery(`
      SELECT 
        p.id,
        p.name,
        p.stock,
        p.min_stock,
        p.unit_type,
        c.name as category_name,
        CASE 
          WHEN p.stock = 0 THEN 'critical'
          WHEN p.stock <= p.min_stock THEN 'critical'
          WHEN p.stock <= (p.min_stock * 1.5) THEN 'warning'
          ELSE 'normal'
        END as level
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.active = TRUE AND p.stock <= p.min_stock
      ORDER BY 
        CASE 
          WHEN p.stock = 0 THEN 1
          WHEN p.stock <= p.min_stock THEN 2
          WHEN p.stock <= (p.min_stock * 1.5) THEN 3
          ELSE 4
        END,
        p.stock ASC
      LIMIT 10
    `)

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
