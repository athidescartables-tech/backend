import { executeQuery, executeTransaction } from "../config/database.js"

// Función auxiliar para formatear métodos de pago (igual que sales)
const formatPaymentMethods = (delivery) => {
  if (delivery.payment_method === "multiple" && delivery.payment_methods) {
    try {
      const methods = JSON.parse(delivery.payment_methods)
      return {
        ...delivery,
        payment_methods_formatted: methods,
        payment_method_display: methods
          .map((m) => `${getPaymentMethodLabel(m.method)}: ${formatCurrency(m.amount)}`)
          .join(", "),
      }
    } catch (error) {
      console.warn("Error parsing payment_methods:", error)
      return delivery
    }
  }
  return {
    ...delivery,
    payment_method_display: getPaymentMethodLabel(delivery.payment_method),
  }
}

const getPaymentMethodLabel = (method) => {
  const labels = {
    efectivo: "Efectivo",
    tarjeta_credito: "T. Crédito",
    transferencia: "Transferencia",
    cuenta_corriente: "Cta. Corriente",
  }
  return labels[method] || method
}

const formatCurrency = (amount) => {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
  }).format(amount)
}

// Obtener todos los repartos con paginación optimizada
export const getDeliveries = async (req, res) => {
  try {
    const { start_date, end_date, status, customer_id, search, page = 1, limit = 25 } = req.query

    let sql = `
    SELECT 
      d.*,
      u.name as driver_name,
      c.name as customer_name,
      c.phone as customer_phone,
      COUNT(di.id) as items_count,
      SUM(di.quantity) as total_items
    FROM deliveries d
    LEFT JOIN users u ON d.driver_id = u.id
    LEFT JOIN customers c ON d.customer_id = c.id
    LEFT JOIN delivery_items di ON d.id = di.delivery_id
    WHERE 1=1
  `
    const params = []

    if (start_date && /^\d{4}-\d{2}-\d{2}$/.test(start_date)) {
      sql += ` AND DATE(d.created_at) >= ?`
      params.push(start_date)
    }

    if (end_date && /^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
      sql += ` AND DATE(d.created_at) <= ?`
      params.push(end_date)
    }

    if (status && ["pending", "in_progress", "completed", "cancelled"].includes(status)) {
      sql += ` AND d.status = ?`
      params.push(status)
    }

    if (customer_id && !isNaN(Number.parseInt(customer_id))) {
      sql += ` AND d.customer_id = ?`
      params.push(Number.parseInt(customer_id))
    }

    if (search && search.trim()) {
      sql += ` AND (d.id LIKE ? OR c.name LIKE ? OR u.name LIKE ?)`
      const searchTerm = `%${search.trim()}%`
      params.push(searchTerm, searchTerm, searchTerm)
    }

    sql += ` GROUP BY d.id ORDER BY d.created_at DESC`

    const pageNum = Math.max(1, Number.parseInt(page) || 1)
    const limitNum = Math.min(100, Math.max(1, Number.parseInt(limit) || 25))
    const offset = (pageNum - 1) * limitNum

    let countSql = `SELECT COUNT(DISTINCT d.id) as total FROM deliveries d 
                  LEFT JOIN customers c ON d.customer_id = c.id 
                  LEFT JOIN users u ON d.driver_id = u.id 
                  WHERE 1=1`
    const countParams = []

    if (start_date && /^\d{4}-\d{2}-\d{2}$/.test(start_date)) {
      countSql += ` AND DATE(d.created_at) >= ?`
      countParams.push(start_date)
    }
    if (end_date && /^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
      countSql += ` AND DATE(d.created_at) <= ?`
      countParams.push(end_date)
    }
    if (status && ["pending", "in_progress", "completed", "cancelled"].includes(status)) {
      countSql += ` AND d.status = ?`
      countParams.push(status)
    }
    if (customer_id && !isNaN(Number.parseInt(customer_id))) {
      countSql += ` AND d.customer_id = ?`
      countParams.push(Number.parseInt(customer_id))
    }
    if (search && search.trim()) {
      countSql += ` AND (d.id LIKE ? OR c.name LIKE ? OR u.name LIKE ?)`
      const searchTerm = `%${search.trim()}%`
      countParams.push(searchTerm, searchTerm, searchTerm)
    }

    const [countResult, deliveries] = await Promise.all([
      executeQuery(countSql, countParams),
      executeQuery(`${sql} LIMIT ${limitNum} OFFSET ${offset}`, params),
    ])

    const formattedDeliveries = deliveries.map(formatPaymentMethods)

    const total = Number.parseInt(countResult[0].total)
    const totalPages = Math.ceil(total / limitNum)

    res.json({
      success: true,
      data: {
        deliveries: formattedDeliveries,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: totalPages,
        },
      },
    })
  } catch (error) {
    console.error("Error al obtener repartos:", error)
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      code: "DELIVERIES_FETCH_ERROR",
    })
  }
}

// Obtener reparto por ID con detalles completos
export const getDeliveryById = async (req, res) => {
  try {
    const { id } = req.params

    if (!id || isNaN(Number.parseInt(id))) {
      return res.status(400).json({
        success: false,
        message: "ID de reparto inválido",
        code: "INVALID_DELIVERY_ID",
      })
    }

    const deliveryQuery = `
    SELECT 
      d.*,
      u.name as driver_name,
      u.email as driver_email,
      u.phone as driver_phone,
      c.name as customer_name,
      c.email as customer_email,
      c.phone as customer_phone,
      c.address as customer_address
    FROM deliveries d
    LEFT JOIN users u ON d.driver_id = u.id
    LEFT JOIN customers c ON d.customer_id = c.id
    WHERE d.id = ?
  `

    const deliveries = await executeQuery(deliveryQuery, [Number.parseInt(id)])

    if (deliveries.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Reparto no encontrado",
        code: "DELIVERY_NOT_FOUND",
      })
    }

    const delivery = formatPaymentMethods(deliveries[0])

    const itemsQuery = `
    SELECT 
      di.*,
      p.name as product_name,
      p.image as product_image,
      p.barcode as product_barcode,
      p.unit_type as product_unit_type
    FROM delivery_items di
    LEFT JOIN products p ON di.product_id = p.id
    WHERE di.delivery_id = ?
    ORDER BY di.id
  `

    const items = await executeQuery(itemsQuery, [Number.parseInt(id)])

    const locationsQuery = `
    SELECT * FROM delivery_locations
    WHERE delivery_id = ?
    ORDER BY created_at DESC
  `

    const locations = await executeQuery(locationsQuery, [Number.parseInt(id)])

    res.json({
      success: true,
      data: {
        ...delivery,
        items,
        locations,
      },
    })
  } catch (error) {
    console.error("Error al obtener reparto:", error)
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      code: "DELIVERY_FETCH_ERROR",
    })
  }
}

// Crear nuevo reparto
export const createDelivery = async (req, res) => {
  try {
    const { items, total, customer_id, driver_id, notes, payment_method, payment_methods } = req.body

    console.log("🚀 === INICIO CREAR REPARTO ===")
    console.log("📝 Datos recibidos:", {
      customer_id,
      driver_id,
      items_count: items?.length,
      total,
    })

    // Validaciones básicas
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "El reparto debe tener al menos un producto",
        code: "NO_ITEMS",
      })
    }

    if (!customer_id || isNaN(Number.parseInt(customer_id))) {
      return res.status(400).json({
        success: false,
        message: "Se requiere un cliente válido para el reparto",
        code: "CUSTOMER_REQUIRED",
      })
    }

    if (!driver_id || isNaN(Number.parseInt(driver_id))) {
      return res.status(400).json({
        success: false,
        message: "Se requiere un repartidor válido",
        code: "DRIVER_REQUIRED",
      })
    }

    const totalAmount = Number.parseFloat(total)
    if (isNaN(totalAmount) || totalAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "El total debe ser un número válido mayor a 0",
        code: "INVALID_TOTAL",
      })
    }

    // Validar cada item
    for (const item of items) {
      if (!item.product_id || isNaN(Number.parseInt(item.product_id))) {
        return res.status(400).json({
          success: false,
          message: "ID de producto inválido",
          code: "INVALID_PRODUCT_ID",
        })
      }

      if (!item.quantity || isNaN(Number.parseFloat(item.quantity)) || Number.parseFloat(item.quantity) <= 0) {
        return res.status(400).json({
          success: false,
          message: "La cantidad debe ser mayor a 0",
          code: "INVALID_QUANTITY",
        })
      }

      if (!item.unit_price || isNaN(Number.parseFloat(item.unit_price)) || Number.parseFloat(item.unit_price) <= 0) {
        return res.status(400).json({
          success: false,
          message: "Precio unitario inválido",
          code: "INVALID_UNIT_PRICE",
        })
      }
    }

    // Verificar cliente existe
    const customerQuery = await executeQuery("SELECT id, name FROM customers WHERE id = ? AND active = true", [
      Number.parseInt(customer_id),
    ])

    if (customerQuery.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Cliente no encontrado o inactivo",
        code: "CUSTOMER_NOT_FOUND",
      })
    }

    // Verificar driver existe
    const driverQuery = await executeQuery("SELECT id, name FROM users WHERE id = ? AND active = true", [
      Number.parseInt(driver_id),
    ])

    if (driverQuery.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Repartidor no encontrado o inactivo",
        code: "DRIVER_NOT_FOUND",
      })
    }

    // Crear el reparto
    console.log("💾 Creando reparto en base de datos...")

    const deliveryResult = await executeQuery(
      `INSERT INTO deliveries (
      total, customer_id, driver_id, notes, payment_method, payment_methods,
      status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)`,
      [
        totalAmount,
        Number.parseInt(customer_id),
        Number.parseInt(driver_id),
        notes,
        payment_methods && Array.isArray(payment_methods) ? "multiple" : payment_method || "efectivo",
        payment_methods && Array.isArray(payment_methods) ? JSON.stringify(payment_methods) : null,
      ],
    )

    const deliveryId = deliveryResult.insertId
    console.log("✅ Reparto creado con ID:", deliveryId)

    // Crear items del reparto
    const queries = []

    for (const item of items) {
      queries.push({
        query: `
        INSERT INTO delivery_items (
          delivery_id, product_id, quantity, unit_price, subtotal, created_at
        ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `,
        params: [
          deliveryId,
          Number.parseInt(item.product_id),
          Number.parseFloat(item.quantity),
          Number.parseFloat(item.unit_price),
          Number.parseFloat(item.quantity) * Number.parseFloat(item.unit_price),
        ],
      })
    }

    if (queries.length > 0) {
      console.log("🔄 Ejecutando transacción con", queries.length, "items...")
      await executeTransaction(queries)
    }

    // Obtener el reparto creado
    const newDelivery = await executeQuery(
      `
    SELECT 
      d.*,
      u.name as driver_name,
      c.name as customer_name
    FROM deliveries d
    LEFT JOIN users u ON d.driver_id = u.id
    LEFT JOIN customers c ON d.customer_id = c.id
    WHERE d.id = ?
  `,
      [deliveryId],
    )

    const deliveryItems = await executeQuery(
      `
    SELECT 
      di.*,
      p.name as product_name
    FROM delivery_items di
    LEFT JOIN products p ON di.product_id = p.id
    WHERE di.delivery_id = ?
  `,
      [deliveryId],
    )

    console.log("🎉 === REPARTO CREADO EXITOSAMENTE ===")

    res.status(201).json({
      success: true,
      message: "Reparto creado correctamente",
      data: {
        ...formatPaymentMethods(newDelivery[0]),
        items: deliveryItems,
      },
    })
  } catch (error) {
    console.error("💥 Error al crear reparto:", error)
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      code: "DELIVERY_CREATE_ERROR",
      details: error.message,
    })
  }
}

// Actualizar estado del reparto (para móvil)
export const updateDeliveryStatus = async (req, res) => {
  try {
    const { id } = req.params
    const { status, notes, latitude, longitude } = req.body

    if (!id || isNaN(Number.parseInt(id))) {
      return res.status(400).json({
        success: false,
        message: "ID de reparto inválido",
        code: "INVALID_DELIVERY_ID",
      })
    }

    if (!["pending", "in_progress", "completed", "cancelled"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Estado inválido",
        code: "INVALID_STATUS",
      })
    }

    const deliveryId = Number.parseInt(id)

    // Verificar que el reparto existe
    const existingDelivery = await executeQuery("SELECT * FROM deliveries WHERE id = ?", [deliveryId])

    if (existingDelivery.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Reparto no encontrado",
        code: "DELIVERY_NOT_FOUND",
      })
    }

    const delivery = existingDelivery[0]

    const queries = []

    // Actualizar estado
    queries.push({
      query: `
      UPDATE deliveries 
      SET status = ?,
          notes = IF(?, CONCAT(COALESCE(notes, ''), ' - ', ?), notes),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
      params: [status, notes ? 1 : 0, notes, deliveryId],
    })

    // Registrar ubicación si se proporciona
    if (latitude !== undefined && longitude !== undefined) {
      const lat = Number.parseFloat(latitude)
      const lon = Number.parseFloat(longitude)

      if (!isNaN(lat) && !isNaN(lon)) {
        queries.push({
          query: `
          INSERT INTO delivery_locations (
            delivery_id, latitude, longitude, created_at
          ) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        `,
          params: [deliveryId, lat, lon],
        })
      }
    }

    // Registrar cambio de estado
    queries.push({
      query: `
      INSERT INTO delivery_status_history (
        delivery_id, previous_status, new_status, user_id, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `,
      params: [deliveryId, delivery.status, status, req.user?.id || null, notes || null],
    })

    await executeTransaction(queries)

    // Obtener reparto actualizado
    const updatedDelivery = await executeQuery("SELECT * FROM deliveries WHERE id = ?", [deliveryId])

    res.json({
      success: true,
      message: "Estado del reparto actualizado correctamente",
      data: formatPaymentMethods(updatedDelivery[0]),
    })
  } catch (error) {
    console.error("Error actualizando estado del reparto:", error)
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      code: "DELIVERY_UPDATE_ERROR",
      details: error.message,
    })
  }
}

// Obtener repartos pendientes para un repartidor (optimizado para móvil)
export const getDriverDeliveries = async (req, res) => {
  try {
    const { driver_id } = req.params
    const { status = "pending" } = req.query

    if (!driver_id || isNaN(Number.parseInt(driver_id))) {
      return res.status(400).json({
        success: false,
        message: "ID de repartidor inválido",
        code: "INVALID_DRIVER_ID",
      })
    }

    let statusFilter = ""
    if (status && ["pending", "in_progress", "completed"].includes(status)) {
      statusFilter = ` AND d.status = '${status}'`
    }

    const deliveries = await executeQuery(
      `
    SELECT 
      d.id,
      d.customer_id,
      d.total,
      d.status,
      d.notes,
      d.created_at,
      c.name as customer_name,
      c.phone as customer_phone,
      c.address as customer_address,
      COUNT(di.id) as items_count,
      SUM(di.quantity) as total_items
    FROM deliveries d
    LEFT JOIN customers c ON d.customer_id = c.id
    LEFT JOIN delivery_items di ON d.id = di.delivery_id
    WHERE d.driver_id = ? ${statusFilter}
    GROUP BY d.id
    ORDER BY CASE WHEN d.status = 'in_progress' THEN 0 ELSE 1 END, d.created_at ASC
  `,
      [Number.parseInt(driver_id)],
    )

    res.json({
      success: true,
      data: {
        deliveries: deliveries.map(formatPaymentMethods),
      },
    })
  } catch (error) {
    console.error("Error obteniendo repartos del repartidor:", error)
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      code: "DRIVER_DELIVERIES_ERROR",
    })
  }
}

// Obtener estadísticas de repartos
export const getDeliveriesStats = async (req, res) => {
  try {
    const { period = "today" } = req.query

    let dateFilter = ""

    const validPeriods = ["today", "week", "month", "year"]
    if (!validPeriods.includes(period)) {
      return res.status(400).json({
        success: false,
        message: "Período inválido",
        code: "INVALID_PERIOD",
      })
    }

    switch (period) {
      case "today":
        dateFilter = "AND DATE(d.created_at) = CURDATE()"
        break
      case "week":
        dateFilter = "AND d.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)"
        break
      case "month":
        dateFilter = "AND d.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)"
        break
      case "year":
        dateFilter = "AND d.created_at >= DATE_SUB(NOW(), INTERVAL 1 YEAR)"
        break
    }

    const stats = await executeQuery(
      `
    SELECT 
      COUNT(*) as total_deliveries,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_deliveries,
      SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress_deliveries,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_deliveries,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_deliveries,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN total ELSE 0 END), 0) as total_revenue,
      COALESCE(AVG(CASE WHEN status = 'completed' THEN total ELSE NULL END), 0) as average_delivery,
      COALESCE(SUM(di.quantity), 0) as total_items_delivered
    FROM deliveries d
    LEFT JOIN delivery_items di ON d.id = di.delivery_id
    WHERE 1=1 ${dateFilter}
  `,
    )

    res.json({
      success: true,
      data: stats[0],
    })
  } catch (error) {
    console.error("Error al obtener estadísticas de repartos:", error)
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      code: "DELIVERIES_STATS_ERROR",
    })
  }
}
