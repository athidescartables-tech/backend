import { executeQuery, executeTransaction } from "../config/database.js"

// ACTUALIZADO: Función para registrar pago de cuenta corriente en caja según método de pago
export const registerPaymentInCash = async (customerId, amount, paymentMethod, userId, description) => {
  try {
    console.log("💰 Registrando pago de cuenta corriente en caja:", {
      customerId,
      amount,
      paymentMethod,
      userId,
      description,
    })

    // Verificar que hay una caja abierta
    const openSession = await executeQuery("SELECT id FROM cash_sessions WHERE status = 'open' LIMIT 1")

    if (openSession.length === 0) {
      console.warn("⚠️ No hay caja abierta para registrar el pago")
      return { registered: false, reason: "NO_OPEN_CASH" }
    }

    const sessionId = openSession[0].id

    // CORREGIDO: TODOS los pagos de cuenta corriente se registran en caja
    // Solo cambia si afecta el efectivo físico o no
    const affectsPhysicalCash = paymentMethod === "efectivo"

    // Registrar como ingreso en caja
    await executeQuery(
      `INSERT INTO cash_movements (
    cash_session_id, type, amount, description, payment_method, 
    user_id, created_at
  ) VALUES (?, 'deposit', ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [sessionId, Number.parseFloat(amount), description, paymentMethod, userId],
    )

    console.log(`✅ Pago de cuenta corriente registrado en caja: ${paymentMethod} - ${amount}`)
    console.log(`💰 Afecta efectivo físico: ${affectsPhysicalCash ? 'SÍ' : 'NO'}`)

    return {
      registered: true,
      affects_physical_cash: affectsPhysicalCash,
      method: paymentMethod
    }
  } catch (error) {
    console.error("❌ Error registrando pago en caja:", error)
    return { registered: false, error: error.message }
  }
}

// ACTUALIZADO: Obtener todos los clientes con filtros mejorados
export const getCustomers = async (req, res) => {
  try {
    const {
      search,
      page = 1,
      limit = 50,
      active_only = "all",
      debtors_only = "false",
      sort_by = "",
      sort_order = "desc"
    } = req.query

    console.log("🔍 Parámetros recibidos en backend:", {
      search,
      page,
      limit,
      active_only,
      debtors_only,
      sort_by,
      sort_order
    })

    let sql = `
  SELECT 
    c.*,
    COALESCE(
      SUM(
        CASE 
          WHEN ct.type IN ('venta','ajuste_debito') THEN ct.amount 
          ELSE -ct.amount 
        END
      ), 0
    ) AS current_balance,
    COUNT(ct.id) AS total_transactions,
    MAX(ct.created_at) AS last_transaction_date
  FROM customers c
  LEFT JOIN customer_transactions ct ON c.id = ct.customer_id
  WHERE 1=1
`
    const params = []

    // Filtro por activos/inactivos
    if (active_only === "true") {
      sql += ` AND c.active = TRUE`
    } else if (active_only === "false") {
      sql += ` AND c.active = FALSE`
    }
    // Si active_only === "all", no agregamos filtro

    // Filtro de búsqueda
    if (search && search.trim()) {
      sql += ` AND (
    c.name LIKE ? OR 
    c.email LIKE ? OR 
    c.document_number LIKE ? OR 
    c.phone LIKE ?
  )`
      const searchTerm = `%${search.trim()}%`
      params.push(searchTerm, searchTerm, searchTerm, searchTerm)
    }

    sql += ` GROUP BY c.id`

    // NUEVO: Filtro solo deudores (después del GROUP BY)
    if (debtors_only === "true") {
      sql += ` HAVING current_balance > 0`
    }

    // NUEVO: Ordenamiento
    let orderClause = ""
    if (sort_by) {
      switch (sort_by) {
        case "debt":
          orderClause = `ORDER BY current_balance ${sort_order.toUpperCase()}`
          break
        case "name":
          orderClause = `ORDER BY c.name ${sort_order.toUpperCase()}`
          break
        case "created_at":
          orderClause = `ORDER BY c.created_at ${sort_order.toUpperCase()}`
          break
        case "last_transaction":
          orderClause = `ORDER BY last_transaction_date ${sort_order.toUpperCase()}`
          break
        default:
          orderClause = `ORDER BY c.name ASC`
      }
    } else {
      orderClause = `ORDER BY c.name ASC`
    }

    sql += ` ${orderClause}`

    // Paginación
    const pageNum = Math.max(1, Number.parseInt(page) || 1)
    const limitNum = Math.min(100, Math.max(1, Number.parseInt(limit) || 50))
    const offset = (pageNum - 1) * limitNum

    // Contar total con los mismos filtros
    let countSql = `
  SELECT COUNT(DISTINCT c.id) as total 
  FROM customers c
  LEFT JOIN customer_transactions ct ON c.id = ct.customer_id
  WHERE 1=1
`
    const countParams = []

    // Aplicar los mismos filtros para el conteo
    if (active_only === "true") {
      countSql += ` AND c.active = TRUE`
    } else if (active_only === "false") {
      countSql += ` AND c.active = FALSE`
    }

    if (search && search.trim()) {
      countSql += ` AND (
    c.name LIKE ? OR 
    c.email LIKE ? OR 
    c.document_number LIKE ? OR 
    c.phone LIKE ?
  )`
      const searchTerm = `%${search.trim()}%`
      countParams.push(searchTerm, searchTerm, searchTerm, searchTerm)
    }

    // Para el conteo con filtro de deudores, necesitamos una subconsulta
    if (debtors_only === "true") {
      countSql = `
    SELECT COUNT(*) as total FROM (
      SELECT c.id,
        COALESCE(
          SUM(
            CASE 
              WHEN ct.type IN ('venta','ajuste_debito') THEN ct.amount 
              ELSE -ct.amount 
            END
          ), 0
        ) AS current_balance
      FROM customers c
      LEFT JOIN customer_transactions ct ON c.id = ct.customer_id
      WHERE 1=1
  `

      if (active_only === "true") {
        countSql += ` AND c.active = TRUE`
      } else if (active_only === "false") {
        countSql += ` AND c.active = FALSE`
      }

      if (search && search.trim()) {
        countSql += ` AND (
      c.name LIKE ? OR 
      c.email LIKE ? OR 
      c.document_number LIKE ? OR 
      c.phone LIKE ?
    )`
      }

      countSql += ` GROUP BY c.id HAVING current_balance > 0
    ) as filtered_customers`
    }

    console.log("📊 SQL generado:", sql)
    console.log("🔢 SQL conteo:", countSql)

    const [countResult, customers] = await Promise.all([
      executeQuery(countSql, countParams),
      executeQuery(`${sql} LIMIT ${limitNum} OFFSET ${offset}`, params)
    ])

    const total = Number.parseInt(countResult[0].total)

    console.log(`✅ Encontrados ${customers.length} clientes de ${total} total`)

    res.json({
      success: true,
      data: customers,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    })
  } catch (error) {
    console.error("❌ Error al obtener clientes:", error)
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      code: "CUSTOMERS_FETCH_ERROR",
    })
  }
}

// Obtener cliente por ID
export const getCustomerById = async (req, res) => {
  try {
    const { id } = req.params

    if (!id || isNaN(Number.parseInt(id))) {
      return res.status(400).json({
        success: false,
        message: "ID de cliente inválido",
        code: "INVALID_CUSTOMER_ID",
      })
    }

    const customerQuery = `
  SELECT 
    c.*,
    COALESCE(
      SUM(
        CASE 
          WHEN ct.type IN ('venta','ajuste_debito') THEN ct.amount 
          ELSE -ct.amount 
        END
      ), 0
    ) AS current_balance,
    COUNT(ct.id) AS total_transactions,
    MAX(ct.created_at) AS last_transaction_date
  FROM customers c
  LEFT JOIN customer_transactions ct ON c.id = ct.customer_id
  WHERE c.id = ?
  GROUP BY c.id
`

    const customers = await executeQuery(customerQuery, [Number.parseInt(id)])

    if (customers.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Cliente no encontrado",
        code: "CUSTOMER_NOT_FOUND",
      })
    }

    res.json({
      success: true,
      data: customers[0],
    })
  } catch (error) {
    console.error("Error al obtener cliente:", error)
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      code: "CUSTOMER_FETCH_ERROR",
    })
  }
}

// Crear cliente
export const createCustomer = async (req, res) => {
  try {
    const { name, email, phone, document_type, document_number, address, city, credit_limit, notes } = req.body

    // Validaciones básicas
    if (!name || name.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: "El nombre debe tener al menos 2 caracteres",
        code: "INVALID_NAME",
      })
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Email inválido",
        code: "INVALID_EMAIL",
      })
    }

    if (document_number && document_number.trim()) {
      // Verificar que no exista otro cliente con el mismo documento
      const existingCustomer = await executeQuery(
        "SELECT id FROM customers WHERE document_type = ? AND document_number = ? AND active = TRUE",
        [document_type || "DNI", document_number.trim()],
      )

      if (existingCustomer.length > 0) {
        return res.status(400).json({
          success: false,
          message: "Ya existe un cliente con este documento",
          code: "DOCUMENT_EXISTS",
        })
      }
    }

    const result = await executeQuery(
      `INSERT INTO customers (
    name, email, phone, document_type, document_number, 
    address, city, credit_limit, notes, active, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        name.trim(),
        email?.trim() || null,
        phone?.trim() || null,
        document_type || "DNI",
        document_number?.trim() || null,
        address?.trim() || null,
        city?.trim() || null,
        Number.parseFloat(credit_limit) || 0.0,
        notes?.trim() || null,
      ],
    )

    // Obtener el cliente creado
    const newCustomer = await executeQuery(
      `SELECT 
    c.*,
    0 AS current_balance,
    0 AS total_transactions,
    NULL AS last_transaction_date
  FROM customers c WHERE c.id = ?`,
      [result.insertId],
    )

    res.status(201).json({
      success: true,
      message: "Cliente creado correctamente",
      data: newCustomer[0],
    })
  } catch (error) {
    console.error("Error al crear cliente:", error)
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      code: "CUSTOMER_CREATE_ERROR",
    })
  }
}

// Actualizar cliente
export const updateCustomer = async (req, res) => {
  try {
    const { id } = req.params
    const { name, email, phone, document_type, document_number, address, city, credit_limit, notes, active } = req.body

    if (!id || isNaN(Number.parseInt(id))) {
      return res.status(400).json({
        success: false,
        message: "ID de cliente inválido",
        code: "INVALID_CUSTOMER_ID",
      })
    }

    // Verificar que el cliente existe
    const existingCustomer = await executeQuery("SELECT id FROM customers WHERE id = ?", [Number.parseInt(id)])

    if (existingCustomer.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Cliente no encontrado",
        code: "CUSTOMER_NOT_FOUND",
      })
    }

    // Validaciones
    if (name && name.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: "El nombre debe tener al menos 2 caracteres",
        code: "INVALID_NAME",
      })
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Email inválido",
        code: "INVALID_EMAIL",
      })
    }

    if (document_number && document_number.trim()) {
      // Verificar que no exista otro cliente con el mismo documento
      const existingDocument = await executeQuery(
        "SELECT id FROM customers WHERE document_type = ? AND document_number = ? AND id != ? AND active = TRUE",
        [document_type || "DNI", document_number.trim(), Number.parseInt(id)],
      )

      if (existingDocument.length > 0) {
        return res.status(400).json({
          success: false,
          message: "Ya existe otro cliente con este documento",
          code: "DOCUMENT_EXISTS",
        })
      }
    }

    // Construir query de actualización dinámicamente
    const updates = []
    const params = []

    if (name !== undefined) {
      updates.push("name = ?")
      params.push(name.trim())
    }
    if (email !== undefined) {
      updates.push("email = ?")
      params.push(email?.trim() || null)
    }
    if (phone !== undefined) {
      updates.push("phone = ?")
      params.push(phone?.trim() || null)
    }
    if (document_type !== undefined) {
      updates.push("document_type = ?")
      params.push(document_type)
    }
    if (document_number !== undefined) {
      updates.push("document_number = ?")
      params.push(document_number?.trim() || null)
    }
    if (address !== undefined) {
      updates.push("address = ?")
      params.push(address?.trim() || null)
    }
    if (city !== undefined) {
      updates.push("city = ?")
      params.push(city?.trim() || null)
    }
    if (credit_limit !== undefined) {
      updates.push("credit_limit = ?")
      params.push(Number.parseFloat(credit_limit) || 0.0)
    }
    if (notes !== undefined) {
      updates.push("notes = ?")
      params.push(notes?.trim() || null)
    }
    if (active !== undefined) {
      updates.push("active = ?")
      params.push(Boolean(active))
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No hay campos para actualizar",
        code: "NO_UPDATES",
      })
    }

    updates.push("updated_at = CURRENT_TIMESTAMP")
    params.push(Number.parseInt(id))

    await executeQuery(`UPDATE customers SET ${updates.join(", ")} WHERE id = ?`, params)

    // Obtener cliente actualizado
    const updatedCustomer = await executeQuery(
      `SELECT 
    c.*,
    COALESCE(
      SUM(
        CASE 
          WHEN ct.type IN ('venta','ajuste_debito') THEN ct.amount 
          ELSE -ct.amount 
        END
      ), 0
    ) AS current_balance,
    COUNT(ct.id) AS total_transactions,
    MAX(ct.created_at) AS last_transaction_date
  FROM customers c
  LEFT JOIN customer_transactions ct ON c.id = ct.customer_id
  WHERE c.id = ?
  GROUP BY c.id`,
      [Number.parseInt(id)],
    )

    res.json({
      success: true,
      message: "Cliente actualizado correctamente",
      data: updatedCustomer[0],
    })
  } catch (error) {
    console.error("Error al actualizar cliente:", error)
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      code: "CUSTOMER_UPDATE_ERROR",
    })
  }
}

// Eliminar cliente (soft delete)
export const deleteCustomer = async (req, res) => {
  try {
    const { id } = req.params

    if (!id || isNaN(Number.parseInt(id))) {
      return res.status(400).json({
        success: false,
        message: "ID de cliente inválido",
        code: "INVALID_CUSTOMER_ID",
      })
    }

    // Verificar que el cliente existe
    const existingCustomer = await executeQuery("SELECT id, name FROM customers WHERE id = ?", [Number.parseInt(id)])

    if (existingCustomer.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Cliente no encontrado",
        code: "CUSTOMER_NOT_FOUND",
      })
    }

    // Verificar que no sea el cliente por defecto
    const customer = existingCustomer[0]
    if (customer.name === "Consumidor Final") {
      return res.status(400).json({
        success: false,
        message: "No se puede eliminar el cliente por defecto",
        code: "CANNOT_DELETE_DEFAULT",
      })
    }

    // Verificar que no tenga ventas asociadas
    const salesCount = await executeQuery("SELECT COUNT(*) as count FROM sales WHERE customer_id = ?", [
      Number.parseInt(id),
    ])

    if (salesCount[0].count > 0) {
      return res.status(400).json({
        success: false,
        message: "No se puede eliminar un cliente con ventas asociadas",
        code: "CUSTOMER_HAS_SALES",
      })
    }

    // Soft delete
    await executeQuery("UPDATE customers SET active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [
      Number.parseInt(id),
    ])

    res.json({
      success: true,
      message: "Cliente eliminado correctamente",
    })
  } catch (error) {
    console.error("Error al eliminar cliente:", error)
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      code: "CUSTOMER_DELETE_ERROR",
    })
  }
}

// Obtener transacciones de un cliente
export const getCustomerTransactions = async (req, res) => {
  try {
    const { id } = req.params
    const { page = 1, limit = 50, type } = req.query

    if (!id || isNaN(Number.parseInt(id))) {
      return res.status(400).json({
        success: false,
        message: "ID de cliente inválido",
        code: "INVALID_CUSTOMER_ID",
      })
    }

    // Verificar que el cliente existe
    const customer = await executeQuery("SELECT * FROM customers WHERE id = ?", [Number.parseInt(id)])

    if (customer.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Cliente no encontrado",
        code: "CUSTOMER_NOT_FOUND",
      })
    }

    let sql = `
  SELECT 
    ct.*,
    u.name as user_name
  FROM customer_transactions ct
  LEFT JOIN users u ON ct.user_id = u.id
  WHERE ct.customer_id = ?
`
    const params = [Number.parseInt(id)]

    if (type && ["venta", "pago", "ajuste_debito", "ajuste_credito"].includes(type)) {
      sql += ` AND ct.type = ?`
      params.push(type)
    }

    sql += ` ORDER BY ct.created_at DESC`

    // Paginación
    const pageNum = Math.max(1, Number.parseInt(page) || 1)
    const limitNum = Math.min(100, Math.max(1, Number.parseInt(limit) || 50))
    const offset = (pageNum - 1) * limitNum

    const [transactions, countResult] = await Promise.all([
      executeQuery(`${sql} LIMIT ${limitNum} OFFSET ${offset}`, params),
      executeQuery(`SELECT COUNT(*) as total FROM customer_transactions WHERE customer_id = ?`, [
        Number.parseInt(id),
      ]),
    ])

    const total = Number.parseInt(countResult[0].total)

    res.json({
      success: true,
      data: {
        customer: customer[0],
        transactions,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum),
        },
      },
    })
  } catch (error) {
    console.error("Error al obtener transacciones:", error)
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      code: "TRANSACTIONS_FETCH_ERROR",
    })
  }
}

// CORREGIDO: Crear transacción de cuenta corriente con método de pago específico
export const createAccountTransaction = async (req, res) => {
  try {
    const { customer_id, type, amount, description, reference, payment_method = "efectivo" } = req.body
    const userId = req.user?.id

    console.log("🚀 === INICIO CREAR TRANSACCIÓN CUENTA CORRIENTE ===")
    console.log("📝 Datos recibidos:", {
      customer_id,
      type,
      amount,
      payment_method,
      description,
    })

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Usuario no autenticado",
        code: "UNAUTHORIZED",
      })
    }

    // Validaciones básicas
    if (!customer_id || isNaN(Number.parseInt(customer_id))) {
      return res.status(400).json({
        success: false,
        message: "ID de cliente inválido",
        code: "INVALID_CUSTOMER_ID",
      })
    }

    // UPDATED: Only allow 'pago' and 'ajuste_debito' transaction types
    if (!["pago", "ajuste_debito"].includes(type)) {
      return res.status(400).json({
        success: false,
        message: "Tipo de transacción inválido. Solo se permiten 'pago' y 'ajuste_debito'.",
        code: "INVALID_TRANSACTION_TYPE",
      })
    }

    // ACTUALIZADO: Validar método de pago para pagos (solo los 3 métodos especificados)
    if (type === "pago") {
      const validPaymentMethods = ["efectivo", "transferencia", "tarjeta_credito"]
      if (!validPaymentMethods.includes(payment_method)) {
        return res.status(400).json({
          success: false,
          message: "Método de pago inválido. Métodos válidos: efectivo, transferencia, tarjeta_credito",
          code: "INVALID_PAYMENT_METHOD",
        })
      }
    }

    const transactionAmount = Number.parseFloat(amount)
    if (isNaN(transactionAmount) || transactionAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Monto inválido",
        code: "INVALID_AMOUNT",
      })
    }

    if (!description || description.trim().length < 5) {
      return res.status(400).json({
        success: false,
        message: "La descripción debe tener al menos 5 caracteres",
        code: "INVALID_DESCRIPTION",
      })
    }

    // CRÍTICO: Verificar que el cliente existe y obtener información completa
    const customer = await executeQuery(
      "SELECT id, name, credit_limit, document_number FROM customers WHERE id = ? AND active = TRUE",
      [Number.parseInt(customer_id)]
    )

    if (customer.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Cliente no encontrado o inactivo",
        code: "CUSTOMER_NOT_FOUND",
      })
    }

    const customerData = customer[0]
    console.log("✅ Cliente encontrado:", customerData)

    // CRÍTICO: Verificar que NO sea el cliente "Consumidor Final"
    if (customerData.document_number === "00000000" && customerData.name === "Consumidor Final") {
      console.log("❌ Error: Intento de transacción con Consumidor Final")
      return res.status(400).json({
        success: false,
        message: "El cliente 'Consumidor Final' no puede tener transacciones de cuenta corriente",
        code: "DEFAULT_CUSTOMER_NO_ACCOUNT",
      })
    }

    // Calcular saldo actual
    const balanceResult = await executeQuery(
      `SELECT COALESCE(SUM(CASE WHEN type IN ('venta', 'ajuste_debito') THEN amount ELSE -amount END), 0) as current_balance
   FROM customer_transactions WHERE customer_id = ?`,
      [Number.parseInt(customer_id)],
    )

    const currentBalance = Number.parseFloat(balanceResult[0].current_balance) || 0
    console.log("💰 Saldo actual del cliente:", currentBalance)

    // Validar límite de crédito para ventas y ajustes de débito
    // This logic remains the same as 'ajuste_debito' still increases balance
    if (type === "venta" || type === "ajuste_debito") {
      const creditLimit = Number.parseFloat(customerData.credit_limit) || 0
      const newBalance = currentBalance + transactionAmount

      if (newBalance > creditLimit) {
        return res.status(400).json({
          success: false,
          message: "La transacción excede el límite de crédito del cliente",
          code: "CREDIT_LIMIT_EXCEEDED",
        })
      }
    }

    // CORREGIDO: Crear la transacción correctamente
    console.log("💾 Creando transacción en base de datos...")

    const transactionResult = await executeQuery(
      `INSERT INTO customer_transactions (
    customer_id, type, amount, description, reference, payment_method, user_id, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        Number.parseInt(customer_id),
        type,
        transactionAmount,
        description.trim(),
        reference?.trim() || null,
        type === "pago" ? payment_method : null, // Solo guardar método de pago para pagos
        userId,
      ]
    )

    const transactionId = transactionResult.insertId
    console.log("✅ Transacción creada con ID:", transactionId)

    // ACTUALIZADO: Si es un pago, registrarlo en caja según el método de pago
    let cashRegistrationResult = null
    if (type === "pago") {
      try {
        cashRegistrationResult = await registerPaymentInCash(
          Number.parseInt(customer_id),
          transactionAmount,
          payment_method,
          userId,
          `Pago cuenta corriente (${payment_method}): ${customerData.name} - ${description.trim()}`,
        )
        console.log("✅ Resultado registro en caja:", cashRegistrationResult)
      } catch (cashError) {
        console.warn("⚠️ Error registrando pago en caja:", cashError)
        cashRegistrationResult = { registered: false, error: cashError.message }
      }
    }

    // Calcular nuevo saldo
    const newBalance = type === "ajuste_debito"
      ? currentBalance + transactionAmount
      : currentBalance - transactionAmount // This covers 'pago'

    console.log("📊 Nuevo saldo calculado:", newBalance)

    // Obtener la transacción creada con información completa
    const newTransaction = await executeQuery(
      `SELECT 
    ct.*,
    u.name as user_name
  FROM customer_transactions ct
  LEFT JOIN users u ON ct.user_id = u.id
  WHERE ct.id = ?`,
      [transactionId]
    )

    console.log("🎉 === TRANSACCIÓN CREADA EXITOSAMENTE ===")

    res.status(201).json({
      success: true,
      message: "Transacción registrada correctamente",
      data: {
        transaction: newTransaction[0],
        new_balance: newBalance,
        payment_method: type === "pago" ? payment_method : null,
        cash_registration: cashRegistrationResult,
        registered_in_cash: cashRegistrationResult?.registered || false,
        affects_physical_cash: cashRegistrationResult?.affects_physical_cash || false,
      },
    })
  } catch (error) {
    console.error("💥 Error al crear transacción:", error)
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      code: "TRANSACTION_CREATE_ERROR",
      details: error.message,
    })
  }
}

// Obtener saldo de un cliente
export const getCustomerBalance = async (req, res) => {
  try {
    const { id } = req.params

    if (!id || isNaN(Number.parseInt(id))) {
      return res.status(400).json({
        success: false,
        message: "ID de cliente inválido",
        code: "INVALID_CUSTOMER_ID",
      })
    }

    const balanceQuery = `
  SELECT 
    c.id,
    c.name,
    c.credit_limit,
    COALESCE(
      SUM(
        CASE 
          WHEN ct.type IN ('venta','ajuste_debito') THEN ct.amount 
          ELSE -ct.amount 
        END
      ), 0
    ) AS current_balance,
    COUNT(ct.id) AS total_transactions,
    MAX(ct.created_at) AS last_transaction_date
  FROM customers c
  LEFT JOIN customer_transactions ct ON c.id = ct.customer_id
  WHERE c.id = ? AND c.active = TRUE
  GROUP BY c.id, c.name, c.credit_limit
`

    const result = await executeQuery(balanceQuery, [Number.parseInt(id)])

    if (result.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Cliente no encontrado",
        code: "CUSTOMER_NOT_FOUND",
      })
    }

    res.json({
      success: true,
      data: result[0],
    })
  } catch (error) {
    console.error("Error al obtener saldo:", error)
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      code: "BALANCE_FETCH_ERROR",
    })
  }
}

// Obtener estadísticas de clientes
export const getCustomersStats = async (req, res) => {
  try {
    const stats = await executeQuery(`
  SELECT 
    COUNT(*) as total_customers,
    COUNT(CASE WHEN active = TRUE THEN 1 END) as active_customers,
    COUNT(CASE WHEN active = FALSE THEN 1 END) as inactive_customers,
    COALESCE(AVG(credit_limit), 0) as avg_credit_limit,
    COALESCE(SUM(
      CASE WHEN ct.type IN ('venta','ajuste_debito') THEN ct.amount ELSE -ct.amount END
    ), 0) as total_outstanding_balance
  FROM customers c
  LEFT JOIN customer_transactions ct ON c.id = ct.customer_id
`)

    const topCustomers = await executeQuery(`
  SELECT 
    c.id,
    c.name,
    COALESCE(
      SUM(
        CASE 
          WHEN ct.type IN ('venta','ajuste_debito') THEN ct.amount 
          ELSE -ct.amount 
        END
      ), 0
    ) AS current_balance,
    COUNT(ct.id) AS total_transactions
  FROM customers c
  LEFT JOIN customer_transactions ct ON c.id = ct.customer_id
  WHERE c.active = TRUE
  GROUP BY c.id, c.name
  HAVING current_balance > 0
  ORDER BY current_balance DESC
  LIMIT 10
`)

    res.json({
      success: true,
      data: {
        general: stats[0],
        top_customers: topCustomers,
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
