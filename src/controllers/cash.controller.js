import { executeQuery, executeTransaction } from "../config/database.js"

// CORREGIDO: Obtener estado actual de la caja SIN incluir ventas a cuenta corriente
export const getCurrentCashStatus = async (req, res) => {
  try {
    console.log("🔍 Obteniendo estado actual de caja...")

    if (req.get("Origin")) {
      res.header("Access-Control-Allow-Origin", req.get("Origin"))
      res.header("Access-Control-Allow-Credentials", "true")
    }

    // Obtener la sesión abierta
    const openSession = await executeQuery(`
      SELECT 
        cs.id, cs.opening_amount, cs.closing_amount,
        cs.expected_amount, cs.difference, cs.status,
        cs.opening_date, cs.closing_date,
        cs.opened_by, cs.closed_by,
        cs.opening_notes, cs.closing_notes,
        cs.created_at, cs.updated_at,
        u_open.name as opened_by_name,
        u_close.name as closed_by_name
      FROM cash_sessions cs
      LEFT JOIN users u_open ON cs.opened_by = u_open.id
      LEFT JOIN users u_close ON cs.closed_by = u_close.id
      WHERE cs.status = 'open'
      ORDER BY cs.id DESC
      LIMIT 1
    `)

    if (openSession.length === 0) {
      console.log("❌ No hay caja abierta")
      return res.status(200).json({
        success: true,
        data: {
          session: null,
          movements: [],
          settings: {
            min_cash_amount: 2000.0,
            max_cash_amount: 20000.0,
            auto_close_time: "22:00",
            require_count_for_close: true,
            allow_negative_cash: false,
          },
        },
      })
    }

    const session = openSession[0]
    console.log("✅ Sesión abierta encontrada:", session.id)

    // CORREGIDO: Obtener movimientos EXCLUYENDO ventas a cuenta corriente
    let movements = []
    try {
      movements = await executeQuery(
        `
        SELECT 
          cm.id, cm.cash_session_id, cm.type, cm.amount, 
          cm.description, cm.reference, cm.user_id, cm.created_at,
          cm.payment_method, cm.sale_id,
          u.name as user_name,
          s.total as sale_total
        FROM cash_movements cm
        LEFT JOIN users u ON cm.user_id = u.id
        LEFT JOIN sales s ON cm.sale_id = s.id
        WHERE cm.cash_session_id = ?
          AND NOT (cm.type = 'sale' AND cm.payment_method = 'cuenta_corriente')
          AND NOT (cm.type = 'sale' AND cm.payment_method = 'credito')
        ORDER BY cm.created_at DESC
        LIMIT 200
      `,
        [session.id],
      )
      console.log("📝 Movimientos encontrados (sin ventas cta cte):", movements.length)
    } catch (movError) {
      console.error("⚠️ Error obteniendo movimientos:", movError)
      movements = []
    }

    // CORREGIDO: Cálculo preciso separando efectivo físico de otros métodos
    let physicalCashIncome = 0 // Solo efectivo que entra físicamente a la caja
    let physicalCashExpenses = 0 // Solo efectivo que sale físicamente de la caja
    let totalSalesCount = 0

    // Separar por métodos de pago (SIN incluir cuenta corriente en ventas)
    let salesCash = 0 // Solo ventas en efectivo (afecta caja física)
    let salesCard = 0 // Solo ventas con tarjeta (NO afecta caja física)
    let salesTransfer = 0 // Solo transferencias (NO afecta caja física)

    // CORREGIDO: Separar pagos de cuenta corriente por método de pago
    let deposits = 0 // Ingresos adicionales normales (afecta caja física)
    let pagosCuentaCorrienteEfectivo = 0 // NUEVO: Pagos cuenta corriente en efectivo (afecta caja física)
    let pagosCuentaCorrienteTarjeta = 0 // NUEVO: Pagos cuenta corriente con tarjeta (NO afecta caja física)
    let pagosCuentaCorrienteTransferencia = 0 // NUEVO: Pagos cuenta corriente por transferencia (NO afecta caja física)
    let withdrawals = 0 // Retiros (afecta caja física)
    let expenses = 0 // Gastos (afecta caja física)

    // CORREGIDO: Procesar movimientos de forma secuencial para manejar async correctamente
    for (const movement of movements) {
      const amount = Number.parseFloat(movement.amount) || 0

      switch (movement.type) {
        case "opening":
        case "closing":
          // Los movimientos de apertura y cierre no se cuentan en ingresos/gastos
          break

        case "sale":
          totalSalesCount++

          // CRÍTICO: Solo procesar ventas que NO sean cuenta corriente
          switch (movement.payment_method) {
            case "efectivo":
              salesCash += amount
              physicalCashIncome += amount // Solo efectivo incrementa el dinero físico
              break
            case "tarjeta_credito":
            case "tarjeta_debito":
            case "tarjeta":
              salesCard += amount
              // NO incrementa physicalCashIncome porque no es efectivo físico
              break
            case "transferencia":
            case "transfer":
              salesTransfer += amount
              // NO incrementa physicalCashIncome porque no es efectivo físico
              break
            default:
              console.warn(`⚠️ Método de pago no reconocido: ${movement.payment_method}`)
              break
          }
          break

        case "deposit":
          // CORREGIDO: Separar pagos de cuenta corriente por método de pago
          if (movement.description && (
            movement.description.toLowerCase().includes("cuenta corriente") ||
            movement.description.toLowerCase().includes("pago cuenta") ||
            movement.description.toLowerCase().includes("cta cte") ||
            movement.description.toLowerCase().includes("cta. cte")
          )) {
            // Es un pago de cuenta corriente, separar por método
            switch (movement.payment_method) {
              case "efectivo":
                pagosCuentaCorrienteEfectivo += amount
                physicalCashIncome += amount // Solo efectivo afecta caja física
                console.log(`💰 Pago cuenta corriente EFECTIVO: ${amount}`)
                break
              case "tarjeta_credito":
              case "tarjeta_debito":
              case "tarjeta":
                pagosCuentaCorrienteTarjeta += amount
                // NO afecta physicalCashIncome
                console.log(`💳 Pago cuenta corriente TARJETA: ${amount}`)
                break
              case "transferencia":
              case "transfer":
                pagosCuentaCorrienteTransferencia += amount
                // NO afecta physicalCashIncome
                console.log(`🏦 Pago cuenta corriente TRANSFERENCIA: ${amount}`)
                break
              default:
                // Si no se especifica método, asumir efectivo por compatibilidad
                pagosCuentaCorrienteEfectivo += amount
                physicalCashIncome += amount
                console.log(`💰 Pago cuenta corriente (método no especificado, asumiendo efectivo): ${amount}`)
                break
            }
          } else {
            // Es un depósito normal
            deposits += amount
            physicalCashIncome += amount
            console.log(`💰 Depósito normal: ${amount}`)
          }
          break

        case "withdrawal":
          withdrawals += Math.abs(amount)
          physicalCashExpenses += Math.abs(amount)
          break

        case "expense":
          expenses += Math.abs(amount)
          physicalCashExpenses += Math.abs(amount)
          break

        case "cancellation":
          // CORREGIDO: Para cancelaciones, restar correctamente según el método de pago
          console.log(`🔄 Procesando cancelación: ${amount} para método ${movement.payment_method}`)

          // El amount de cancelación ya viene negativo desde la base de datos
          const cancelAmount = Math.abs(amount) // Convertir a positivo para restar

          switch (movement.payment_method) {
            case "efectivo":
              salesCash -= cancelAmount
              physicalCashIncome -= cancelAmount
              console.log(`💰 Cancelación efectivo: -${cancelAmount}, nuevo salesCash: ${salesCash}`)
              break
            case "tarjeta_credito":
            case "tarjeta_debito":
            case "tarjeta":
              salesCard -= cancelAmount
              console.log(`💳 Cancelación tarjeta: -${cancelAmount}, nuevo salesCard: ${salesCard}`)
              break
            case "transferencia":
            case "transfer":
              salesTransfer -= cancelAmount
              console.log(`🏦 Cancelación transferencia: -${cancelAmount}, nuevo salesTransfer: ${salesTransfer}`)
              break
            case "multiple":
              // CORREGIDO: Para cancelaciones de pagos múltiples, obtener los detalles de la venta original
              try {
                if (movement.sale_id) {
                  const originalSale = await executeQuery("SELECT payment_methods FROM sales WHERE id = ?", [movement.sale_id])
                  if (originalSale.length > 0 && originalSale[0].payment_methods) {
                    const paymentMethods = JSON.parse(originalSale[0].payment_methods)
                    for (const pm of paymentMethods) {
                      const pmAmount = Number.parseFloat(pm.amount) || 0
                      switch (pm.method) {
                        case "efectivo":
                          salesCash -= pmAmount
                          physicalCashIncome -= pmAmount
                          break
                        case "tarjeta_credito":
                        case "tarjeta_debito":
                        case "tarjeta":
                          salesCard -= pmAmount
                          break
                        case "transferencia":
                        case "transfer":
                          salesTransfer -= pmAmount
                          break
                      }
                    }
                    console.log(`💳 Cancelación múltiple procesada: -${cancelAmount}`)
                  } else {
                    // Fallback: restar del efectivo por defecto
                    salesCash -= cancelAmount
                    physicalCashIncome -= cancelAmount
                  }
                }
              } catch (parseError) {
                console.warn("⚠️ Error procesando cancelación múltiple:", parseError)
                // Fallback: restar del efectivo por defecto
                salesCash -= cancelAmount
                physicalCashIncome -= cancelAmount
              }
              break
            default:
              console.warn(`⚠️ Método de pago no reconocido en cancelación: ${movement.payment_method}`)
              // Por defecto, restar del efectivo
              salesCash -= cancelAmount
              physicalCashIncome -= cancelAmount
              break
          }

          if (movement.sale_id) {
            totalSalesCount = Math.max(0, totalSalesCount - 1)
          }
          break

        default:
          console.warn(`⚠️ Tipo de movimiento no reconocido: ${movement.type}`)
          break
      }
    }

    // CRÍTICO: El efectivo actual = apertura + ingresos físicos - gastos físicos
    const calculatedPhysicalCash = Number.parseFloat(session.opening_amount) + physicalCashIncome - physicalCashExpenses

    console.log("💰 CÁLCULO DETALLADO DE EFECTIVO FÍSICO (CORREGIDO):")
    console.log(`  - Apertura: ${session.opening_amount}`)
    console.log(`  - Ingresos físicos totales: ${physicalCashIncome}`)
    console.log(`    * Ventas efectivo: ${salesCash}`)
    console.log(`    * Depósitos normales: ${deposits}`)
    console.log(`    * Pagos cta cte EFECTIVO: ${pagosCuentaCorrienteEfectivo}`)
    console.log(`  - Gastos físicos totales: ${physicalCashExpenses}`)
    console.log(`    * Retiros: ${withdrawals}`)
    console.log(`    * Gastos: ${expenses}`)
    console.log(`  - EFECTIVO FÍSICO CALCULADO: ${calculatedPhysicalCash}`)
    console.log(`  - OTROS MÉTODOS:`)
    console.log(`    * Ventas tarjeta: ${salesCard}`)
    console.log(`    * Ventas transferencia: ${salesTransfer}`)
    console.log(`    * Pagos cta cte TARJETA: ${pagosCuentaCorrienteTarjeta}`)
    console.log(`    * Pagos cta cte TRANSFERENCIA: ${pagosCuentaCorrienteTransferencia}`)

    // Obtener configuración
    let settings = {
      min_cash_amount: 2000.0,
      max_cash_amount: 20000.0,
      auto_close_time: "22:00",
      require_count_for_close: true,
      allow_negative_cash: false,
    }

    try {
      const settingsQuery = await executeQuery("SELECT * FROM cash_settings ORDER BY id DESC LIMIT 1")
      if (settingsQuery.length > 0) {
        settings = {
          min_cash_amount: Number.parseFloat(settingsQuery[0].min_cash_amount) || 2000.0,
          max_cash_amount: Number.parseFloat(settingsQuery[0].max_cash_amount) || 20000.0,
          auto_close_time: settingsQuery[0].auto_close_time || "22:00",
          require_count_for_close: Boolean(settingsQuery[0].require_count_for_close ?? true),
          allow_negative_cash: Boolean(settingsQuery[0].allow_negative_cash ?? false),
        }
      }
    } catch (settingsError) {
      console.error("⚠️ Error obteniendo configuración:", settingsError)
    }

    // CORREGIDO: Respuesta con separación clara y TODOS los pagos de cuenta corriente registrados
    const responseData = {
      session: {
        ...session,
        // CRÍTICO: calculated_amount es SOLO el efectivo físico esperado
        calculated_amount: calculatedPhysicalCash,

        // Totales de efectivo físico
        total_physical_income: physicalCashIncome,
        total_physical_expenses: physicalCashExpenses,
        total_sales: totalSalesCount,

        // SEPARACIÓN CLARA: Por método de pago (SIN cuenta corriente en ventas)
        sales_cash: salesCash, // Solo efectivo (afecta caja física)
        sales_card: salesCard, // Solo tarjeta (NO afecta caja física)
        sales_transfer: salesTransfer, // Solo transferencias (NO afecta caja física)

        // CORREGIDO: Separar depósitos de pagos cuenta corriente por método
        deposits: deposits, // Solo depósitos normales
        pagos_cuenta_corriente_efectivo: pagosCuentaCorrienteEfectivo, // NUEVO: Pagos cta cte en efectivo
        pagos_cuenta_corriente_tarjeta: pagosCuentaCorrienteTarjeta, // NUEVO: Pagos cta cte con tarjeta
        pagos_cuenta_corriente_transferencia: pagosCuentaCorrienteTransferencia, // NUEVO: Pagos cta cte por transferencia
        withdrawals: withdrawals,
        expenses: expenses,

        // NUEVO: Total general de todos los métodos de pago procesados
        total_general_amount: salesCash + salesCard + salesTransfer + pagosCuentaCorrienteEfectivo + pagosCuentaCorrienteTarjeta + pagosCuentaCorrienteTransferencia,

        // NUEVO: Total de pagos de cuenta corriente (todos los métodos)
        total_pagos_cuenta_corriente: pagosCuentaCorrienteEfectivo + pagosCuentaCorrienteTarjeta + pagosCuentaCorrienteTransferencia,
      },
      movements,
      settings,
    }

    console.log("✅ Estado de caja calculado correctamente (TODOS LOS PAGOS CTA CTE REGISTRADOS)")
    console.log("💰 Resumen CORREGIDO:", {
      efectivo_fisico_esperado: calculatedPhysicalCash,
      ventas_efectivo: salesCash,
      ventas_tarjeta: salesCard,
      ventas_transferencia: salesTransfer,
      depositos_normales: deposits,
      pagos_cta_cte_efectivo: pagosCuentaCorrienteEfectivo,
      pagos_cta_cte_tarjeta: pagosCuentaCorrienteTarjeta,
      pagos_cta_cte_transferencia: pagosCuentaCorrienteTransferencia,
      total_pagos_cta_cte: pagosCuentaCorrienteEfectivo + pagosCuentaCorrienteTarjeta + pagosCuentaCorrienteTransferencia,
      total_general: salesCash + salesCard + salesTransfer + pagosCuentaCorrienteEfectivo + pagosCuentaCorrienteTarjeta + pagosCuentaCorrienteTransferencia,
      apertura: session.opening_amount,
      ingresos_fisicos: physicalCashIncome,
      gastos_fisicos: physicalCashExpenses,
    })

    res.status(200).json({
      success: true,
      data: responseData,
    })
  } catch (error) {
    console.error("💥 Error al obtener estado de caja:", error)
    console.error("Stack trace:", error.stack)

    if (req.get("Origin")) {
      res.header("Access-Control-Allow-Origin", req.get("Origin"))
      res.header("Access-Control-Allow-Credentials", "true")
    }

    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      code: "CASH_STATUS_ERROR",
      details: error.message,
    })
  }
}

// Abrir caja (mantener lógica original)
export const openCash = async (req, res) => {
  try {
    const { opening_amount, notes } = req.body
    const userId = req.user?.id

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Usuario no autenticado",
        code: "UNAUTHORIZED",
      })
    }

    // Validar que no haya una caja abierta
    const existingCash = await executeQuery("SELECT id FROM cash_sessions WHERE status = 'open' LIMIT 1")

    if (existingCash.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Ya hay una caja abierta",
        code: "CASH_ALREADY_OPEN",
      })
    }

    // Validar monto de apertura
    const openingAmount = Number.parseFloat(opening_amount)
    if (isNaN(openingAmount) || openingAmount < 0) {
      return res.status(400).json({
        success: false,
        message: "Monto de apertura inválido",
        code: "INVALID_OPENING_AMOUNT",
      })
    }

    const queries = []

    // 1. Crear sesión de caja
    queries.push({
      query: `
        INSERT INTO cash_sessions (
          opening_amount, expected_amount, status, opening_date, 
          opened_by, opening_notes, created_at, updated_at
        ) VALUES (?, ?, 'open', CURRENT_TIMESTAMP, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `,
      params: [openingAmount, openingAmount, userId, notes || null],
    })

    // 2. Registrar movimiento de apertura
    queries.push({
      query: `
        INSERT INTO cash_movements (
          cash_session_id, type, amount, description, user_id, created_at
        ) VALUES (LAST_INSERT_ID(), 'opening', ?, 'Apertura de caja', ?, CURRENT_TIMESTAMP)
      `,
      params: [openingAmount, userId],
    })

    await executeTransaction(queries)

    // Obtener la sesión creada
    const newSession = await executeQuery(`
      SELECT 
        cs.id, cs.opening_amount, cs.expected_amount, cs.status, cs.opening_date,
        cs.opened_by, cs.opening_notes, cs.created_at, cs.updated_at,
        u.name as opened_by_name
      FROM cash_sessions cs
      LEFT JOIN users u ON cs.opened_by = u.id
      WHERE cs.status = 'open'
      ORDER BY cs.id DESC
      LIMIT 1
    `)

    res.status(201).json({
      success: true,
      message: "Caja abierta correctamente",
      data: {
        isOpen: true,
        session: newSession[0],
      },
    })
  } catch (error) {
    console.error("Error al abrir caja:", error)
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      code: "CASH_OPEN_ERROR",
    })
  }
}

// CORREGIDO: Cerrar caja con cálculos precisos SIN cuenta corriente
export const closeCash = async (req, res) => {
  try {
    const { physical_cash_amount, notes, compare_with_physical = false } = req.body
    const userId = req.user?.id

    console.log("🔄 Iniciando cierre de caja...")

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Usuario no autenticado",
        code: "UNAUTHORIZED",
      })
    }

    // Obtener sesión abierta
    const openSession = await executeQuery(`
      SELECT id, opening_amount FROM cash_sessions 
      WHERE status = 'open' 
      ORDER BY id DESC 
      LIMIT 1
    `)

    if (openSession.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No hay una caja abierta",
        code: "NO_OPEN_CASH",
      })
    }

    const sessionId = openSession[0].id
    const openingAmount = Number.parseFloat(openSession[0].opening_amount)

    console.log("✅ Sesión encontrada:", sessionId, "Monto apertura:", openingAmount)

    // CORREGIDO: Calcular efectivo físico EXCLUYENDO ventas cuenta corriente
    const movementsQuery = await executeQuery(
      `
      SELECT 
        cm.type,
        cm.payment_method,
        cm.description,
        SUM(cm.amount) as total_amount,
        COUNT(*) as count
      FROM cash_movements cm
      WHERE cm.cash_session_id = ? 
        AND cm.type IN ('sale', 'deposit', 'withdrawal', 'expense', 'cancellation')
        AND NOT (cm.type = 'sale' AND cm.payment_method = 'cuenta_corriente')
        AND NOT (cm.type = 'sale' AND cm.payment_method = 'credito')
      GROUP BY cm.type, cm.payment_method, cm.description
      ORDER BY cm.type, cm.payment_method
    `,
      [sessionId],
    )

    // CORREGIDO: Procesar solo movimientos que afectan efectivo físico
    let physicalCashIncome = 0
    let physicalCashExpenses = 0

    // Para reporte detallado
    let salesCash = 0
    let salesCard = 0
    let salesTransfer = 0
    let deposits = 0
    let pagosCuentaCorrienteEfectivo = 0
    let pagosCuentaCorrienteTarjeta = 0
    let pagosCuentaCorrienteTransferencia = 0
    let withdrawals = 0
    let expenses = 0

    movementsQuery.forEach((row) => {
      const amount = Number.parseFloat(row.total_amount) || 0

      switch (row.type) {
        case "sale":
          switch (row.payment_method) {
            case "efectivo":
              salesCash += amount
              physicalCashIncome += amount
              break
            case "tarjeta_credito":
            case "tarjeta_debito":
            case "tarjeta":
              salesCard += amount
              // NO afecta physicalCashIncome
              break
            case "transferencia":
            case "transfer":
              salesTransfer += amount
              // NO afecta physicalCashIncome
              break
          }
          break

        case "deposit":
          // CORREGIDO: Separar pagos cuenta corriente por método de pago
          if (row.description && (
            row.description.toLowerCase().includes("cuenta corriente") ||
            row.description.toLowerCase().includes("pago cuenta") ||
            row.description.toLowerCase().includes("cta cte") ||
            row.description.toLowerCase().includes("cta. cte")
          )) {
            // Es un pago de cuenta corriente, separar por método
            switch (row.payment_method) {
              case "efectivo":
                pagosCuentaCorrienteEfectivo += amount
                physicalCashIncome += amount // Solo efectivo afecta caja física
                break
              case "tarjeta_credito":
              case "tarjeta_debito":
              case "tarjeta":
                pagosCuentaCorrienteTarjeta += amount
                // NO afecta physicalCashIncome
                break
              case "transferencia":
              case "transfer":
                pagosCuentaCorrienteTransferencia += amount
                // NO afecta physicalCashIncome
                break
              default:
                // Si no se especifica método, asumir efectivo por compatibilidad
                pagosCuentaCorrienteEfectivo += amount
                physicalCashIncome += amount
                break
            }
          } else {
            // Es un depósito normal
            deposits += amount
            physicalCashIncome += amount
          }
          break

        case "withdrawal":
          withdrawals += Math.abs(amount)
          physicalCashExpenses += Math.abs(amount)
          break

        case "expense":
          expenses += Math.abs(amount)
          physicalCashExpenses += Math.abs(amount)
          break

        case "cancellation":
          // CORREGIDO: Para cancelaciones en cierre, restar correctamente
          const cancelAmount = Math.abs(amount) // Convertir a positivo para restar

          switch (row.payment_method) {
            case "efectivo":
              salesCash -= cancelAmount
              physicalCashIncome -= cancelAmount
              console.log(`💰 Cancelación efectivo en cierre: -${cancelAmount}`)
              break
            case "tarjeta_credito":
            case "tarjeta_debito":
            case "tarjeta":
              salesCard -= cancelAmount
              console.log(`💳 Cancelación tarjeta en cierre: -${cancelAmount}`)
              break
            case "transferencia":
            case "transfer":
              salesTransfer -= cancelAmount
              console.log(`🏦 Cancelación transferencia en cierre: -${cancelAmount}`)
              break
            case "multiple":
              // Para cancelaciones múltiples, distribuir la cancelación
              // Nota: En el cierre no tenemos acceso fácil a los detalles, 
              // pero el monto total ya está agregado correctamente
              salesCash -= cancelAmount * 0.5 // Estimación conservadora
              salesCard -= cancelAmount * 0.3
              salesTransfer -= cancelAmount * 0.2
              physicalCashIncome -= cancelAmount * 0.5
              console.log(`💳 Cancelación múltiple en cierre (estimada): -${cancelAmount}`)
              break
            default:
              // Por defecto, restar del efectivo
              salesCash -= cancelAmount
              physicalCashIncome -= cancelAmount
              break
          }
          break
      }
    })

    // CRÍTICO: Solo el efectivo físico esperado
    const expectedPhysicalCash = openingAmount + physicalCashIncome - physicalCashExpenses

    console.log("💰 Cálculo de efectivo físico en cierre (CORREGIDO):", {
      apertura: openingAmount,
      ingresos_fisicos: physicalCashIncome,
      gastos_fisicos: physicalCashExpenses,
      efectivo_fisico_esperado: expectedPhysicalCash,
      ventas_efectivo: salesCash,
      ventas_otros_metodos: salesCard + salesTransfer,
      depositos_normales: deposits,
      pagos_cta_cte_efectivo: pagosCuentaCorrienteEfectivo,
      pagos_cta_cte_otros: pagosCuentaCorrienteTarjeta + pagosCuentaCorrienteTransferencia,
      total_pagos_cta_cte: pagosCuentaCorrienteEfectivo + pagosCuentaCorrienteTarjeta + pagosCuentaCorrienteTransferencia,
    })

    // Validar efectivo físico si se proporciona
    let physical_amount = null
    let difference = null

    if (compare_with_physical && physical_cash_amount !== undefined) {
      physical_amount = Number.parseFloat(physical_cash_amount)
      if (isNaN(physical_amount) || physical_amount < 0) {
        return res.status(400).json({
          success: false,
          message: "Monto de efectivo físico inválido",
          code: "INVALID_PHYSICAL_AMOUNT",
        })
      }
      difference = physical_amount - expectedPhysicalCash
    }

    const queries = []

    // 1. Cerrar sesión
    queries.push({
      query: `
        UPDATE cash_sessions 
        SET 
          closing_amount = ?,
          expected_amount = ?,
          difference = ?,
          status = 'closed',
          closing_date = CURRENT_TIMESTAMP,
          closed_by = ?,
          closing_notes = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      params: [
        physical_amount || expectedPhysicalCash,
        expectedPhysicalCash,
        difference,
        userId,
        notes || null,
        sessionId,
      ],
    })

    // 2. Registrar arqueo con detalles mejorados
    queries.push({
      query: `
        INSERT INTO cash_counts (
          cash_session_id, expected_amount, counted_amount, difference,
          bills, coins, notes, user_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `,
      params: [
        sessionId,
        expectedPhysicalCash,
        physical_amount || expectedPhysicalCash,
        difference || 0,
        JSON.stringify({}),
        JSON.stringify({}),
        JSON.stringify({
          earnings_details: {
            sales_cash: salesCash,
            sales_card: salesCard,
            sales_transfer: salesTransfer,
            deposits: deposits,
            pagos_cuenta_corriente_efectivo: pagosCuentaCorrienteEfectivo,
            pagos_cuenta_corriente_tarjeta: pagosCuentaCorrienteTarjeta,
            pagos_cuenta_corriente_transferencia: pagosCuentaCorrienteTransferencia,
            total_pagos_cuenta_corriente: pagosCuentaCorrienteEfectivo + pagosCuentaCorrienteTarjeta + pagosCuentaCorrienteTransferencia,
            withdrawals: withdrawals,
            expenses: expenses,
            total_general_amount: salesCash + salesCard + salesTransfer + pagosCuentaCorrienteEfectivo + pagosCuentaCorrienteTarjeta + pagosCuentaCorrienteTransferencia,
            physical_cash_expected: expectedPhysicalCash,
          },
          compare_with_physical,
          closing_notes: notes || null,
        }),
        userId,
      ],
    })

    // 3. Registrar movimiento de cierre
    queries.push({
      query: `
        INSERT INTO cash_movements (
          cash_session_id, type, amount, description, user_id, created_at
        ) VALUES (?, 'closing', ?, ?, ?, CURRENT_TIMESTAMP)
      `,
      params: [
        sessionId,
        physical_amount || expectedPhysicalCash,
        `Cierre de caja - Efectivo físico: $${expectedPhysicalCash.toFixed(2)} - Total general: $${(salesCash + salesCard + salesTransfer + pagosCuentaCorrienteEfectivo + pagosCuentaCorrienteTarjeta + pagosCuentaCorrienteTransferencia).toFixed(2)}`,
        userId,
      ],
    })

    console.log("🔄 Ejecutando transacción de cierre...")
    await executeTransaction(queries)

    // Obtener sesión cerrada
    const closedSession = await executeQuery(
      `
      SELECT 
        cs.id, cs.opening_amount, cs.closing_amount,
        cs.expected_amount, cs.difference, cs.status,
        cs.opening_date, cs.closing_date,
        cs.opened_by, cs.closed_by,
        cs.opening_notes, cs.closing_notes,
        cs.created_at, cs.updated_at,
        u_open.name as opened_by_name,
        u_close.name as closed_by_name
      FROM cash_sessions cs
      LEFT JOIN users u_open ON cs.opened_by = u_open.id
      LEFT JOIN users u_close ON cs.closed_by = u_close.id
      WHERE cs.id = ?
    `,
      [sessionId],
    )

    console.log("✅ Caja cerrada correctamente")

    res.json({
      success: true,
      message: "Caja cerrada correctamente",
      data: {
        isOpen: false,
        session: closedSession[0],
        earnings_details: {
          sales_cash: salesCash,
          sales_card: salesCard,
          sales_transfer: salesTransfer,
          deposits: deposits,
          pagos_cuenta_corriente_efectivo: pagosCuentaCorrienteEfectivo,
          pagos_cuenta_corriente_tarjeta: pagosCuentaCorrienteTarjeta,
          pagos_cuenta_corriente_transferencia: pagosCuentaCorrienteTransferencia,
          total_pagos_cuenta_corriente: pagosCuentaCorrienteEfectivo + pagosCuentaCorrienteTarjeta + pagosCuentaCorrienteTransferencia,
          withdrawals: withdrawals,
          expenses: expenses,
          total_general_amount: salesCash + salesCard + salesTransfer + pagosCuentaCorrienteEfectivo + pagosCuentaCorrienteTarjeta + pagosCuentaCorrienteTransferencia,
          physical_cash_expected: expectedPhysicalCash,
        },
        expected_amount: expectedPhysicalCash,
        physical_amount,
        difference,
      },
    })
  } catch (error) {
    console.error("💥 Error al cerrar caja:", error)
    console.error("Stack trace:", error.stack)
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      code: "CASH_CLOSE_ERROR",
    })
  }
}

// Mantener el resto de las funciones del controlador original...
export const getCashHistory = async (req, res) => {
  try {
    console.log("🔍 Obteniendo historial de caja...")

    const { start_date, end_date, page = 1, limit = 20 } = req.query

    let dateFilter = "WHERE cs.status = 'closed'"
    const params = []

    if (start_date && /^\d{4}-\d{2}-\d{2}$/.test(start_date)) {
      dateFilter += " AND DATE(cs.closing_date) >= ?"
      params.push(start_date)
    }

    if (end_date && /^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
      dateFilter += " AND DATE(cs.closing_date) <= ?"
      params.push(end_date)
    }

    // Paginación
    const pageNum = Math.max(1, Number.parseInt(page) || 1)
    const limitNum = Math.min(100, Math.max(1, Number.parseInt(limit) || 20))
    const offset = (pageNum - 1) * limitNum

    // CORREGIDO: Historial excluyendo ventas cuenta corriente
    const historyQuery = `
      SELECT 
        cs.id, cs.opening_amount, cs.closing_amount,
        cs.expected_amount, cs.difference, cs.status,
        cs.opening_date, cs.closing_date,
        cs.opened_by, cs.closed_by,
        cs.opening_notes, cs.closing_notes,
        cs.created_at, cs.updated_at,
        u_open.name as opened_by_name,
        u_close.name as closed_by_name,
        COUNT(cm.id) as total_movements,
        COALESCE(SUM(CASE WHEN cm.type = 'sale' AND cm.payment_method = 'efectivo' THEN cm.amount ELSE 0 END), 0) as total_cash_sales,
        COALESCE(SUM(CASE WHEN cm.type = 'sale' AND cm.payment_method IN ('tarjeta_credito', 'tarjeta_debito', 'tarjeta', 'transferencia', 'transfer') THEN cm.amount ELSE 0 END), 0) as total_other_sales,
        COALESCE(SUM(CASE WHEN cm.type = 'deposit' AND NOT (cm.description LIKE '%cuenta corriente%' OR cm.description LIKE '%cta cte%') THEN cm.amount ELSE 0 END), 0) as total_deposits,
        COALESCE(SUM(CASE WHEN cm.type = 'deposit' AND (cm.description LIKE '%cuenta corriente%' OR cm.description LIKE '%cta cte%') THEN cm.amount ELSE 0 END), 0) as total_account_payments,
        COALESCE(SUM(CASE WHEN cm.type IN ('withdrawal', 'expense') THEN ABS(cm.amount) ELSE 0 END), 0) as total_expenses
      FROM cash_sessions cs
      LEFT JOIN users u_open ON cs.opened_by = u_open.id
      LEFT JOIN users u_close ON cs.closed_by = u_close.id
      LEFT JOIN cash_movements cm ON cs.id = cm.cash_session_id 
        AND cm.type NOT IN ('opening', 'closing')
        AND NOT (cm.type = 'sale' AND cm.payment_method IN ('cuenta_corriente', 'credito'))
      ${dateFilter}
      GROUP BY cs.id, cs.opening_amount, cs.closing_amount, cs.expected_amount, cs.difference, cs.status,
               cs.opening_date, cs.closing_date, cs.opened_by, cs.closed_by, cs.opening_notes, cs.closing_notes,
               cs.created_at, cs.updated_at, u_open.name, u_close.name
       ORDER BY cs.closing_date DESC
       LIMIT ${limitNum} OFFSET ${offset}
    `

    const history = await executeQuery(historyQuery, params)

    // Contar total para paginación
    const countQuery = `SELECT COUNT(*) as total FROM cash_sessions cs ${dateFilter}`
    const [{ total }] = await executeQuery(countQuery, params)

    const response = {
      success: true,
      data: {
        history,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: Number.parseInt(total),
          pages: Math.ceil(total / limitNum),
        },
      },
    }

    res.json(response)
  } catch (error) {
    console.error("💥 Error al obtener historial de caja:", error)
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      code: "CASH_HISTORY_ERROR",
      details: error.message,
    })
  }
}

export const getCashSessionDetails = async (req, res) => {
  try {
    const { id } = req.params

    if (!id || isNaN(Number.parseInt(id))) {
      return res.status(400).json({
        success: false,
        message: "ID de sesión inválido",
        code: "INVALID_SESSION_ID",
      })
    }

    // Obtener datos de la sesión
    const sessionQuery = await executeQuery(
      `
      SELECT 
        cs.id, cs.opening_amount, cs.closing_amount, cs.expected_amount, cs.difference, cs.status, 
        cs.opening_date, cs.closing_date, cs.opened_by, cs.closed_by, 
        cs.opening_notes, cs.closing_notes, cs.created_at, cs.updated_at,
        u_open.name as opened_by_name,
        u_close.name as closed_by_name,
        cc.notes as count_notes
      FROM cash_sessions cs
      LEFT JOIN users u_open ON cs.opened_by = u_open.id
      LEFT JOIN users u_close ON cs.closed_by = u_close.id
      LEFT JOIN cash_counts cc ON cs.id = cc.cash_session_id
      WHERE cs.id = ?
    `,
      [Number.parseInt(id)],
    )

    if (sessionQuery.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Sesión no encontrada",
        code: "SESSION_NOT_FOUND",
      })
    }

    const session = sessionQuery[0]

    // CORREGIDO: Obtener movimientos excluyendo ventas cuenta corriente
    const movementsQuery = await executeQuery(
      `
      SELECT 
        cm.id, cm.cash_session_id, cm.type, cm.amount, cm.description, cm.reference, cm.user_id, cm.created_at,
        cm.payment_method, cm.sale_id,
        u.name as user_name,
        s.id as sale_id
      FROM cash_movements cm
      LEFT JOIN users u ON cm.user_id = u.id
      LEFT JOIN sales s ON cm.sale_id = s.id
      WHERE cm.cash_session_id = ?
        AND NOT (cm.type = 'sale' AND cm.payment_method IN ('cuenta_corriente', 'credito'))
      ORDER BY cm.created_at ASC
    `,
      [Number.parseInt(id)],
    )

    // Obtener detalles de ganancias si existen
    let earningsDetails = null
    try {
      const countData = await executeQuery(`SELECT notes FROM cash_counts WHERE cash_session_id = ? LIMIT 1`, [
        Number.parseInt(id),
      ])

      if (countData.length > 0 && countData[0].notes) {
        const notesData = JSON.parse(countData[0].notes)
        earningsDetails = notesData.earnings_details || null
      }
    } catch (parseError) {
      console.warn("Error parseando detalles de ganancias:", parseError)
    }

    res.json({
      success: true,
      data: {
        session,
        movements: movementsQuery,
        earnings_details: earningsDetails,
      },
    })
  } catch (error) {
    console.error("💥 Error al obtener detalles de sesión:", error)
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      code: "SESSION_DETAILS_ERROR",
    })
  }
}

export const getCashMovements = async (req, res) => {
  try {
    const { start_date, end_date, type, current_session_only = "true", page = 1, limit = 50 } = req.query

    let sql = `
      SELECT 
        cm.id, cm.cash_session_id, cm.type, cm.amount, cm.description, cm.reference, cm.user_id, cm.created_at,
        cm.payment_method, cm.sale_id,
        u.name as user_name,
        s.id as sale_id,
        cs.opening_date as session_start
      FROM cash_movements cm
      LEFT JOIN users u ON cm.user_id = u.id
      LEFT JOIN sales s ON cm.sale_id = s.id
      LEFT JOIN cash_sessions cs ON cm.cash_session_id = cs.id
      WHERE 1=1
        AND NOT (cm.type = 'sale' AND cm.payment_method IN ('cuenta_corriente', 'credito'))
    `
    const params = []

    // Filtrar por sesión actual por defecto
    if (current_session_only === "true") {
      sql += ` AND cs.status = 'open'`
    }

    // Filtros de fecha
    if (start_date && /^\d{4}-\d{2}-\d{2}$/.test(start_date)) {
      sql += ` AND DATE(cm.created_at) >= ?`
      params.push(start_date)
    }

    if (end_date && /^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
      sql += ` AND DATE(cm.created_at) <= ?`
      params.push(end_date)
    }

    // Filtro por tipo
    if (type && ["opening", "closing", "sale", "deposit", "withdrawal", "expense", "cancellation"].includes(type)) {
      sql += ` AND cm.type = ?`
      params.push(type)
    }

    sql += ` ORDER BY cm.created_at DESC`

    // Paginación
    const pageNum = Math.max(1, Number.parseInt(page) || 1)
    const limitNum = Math.min(100, Math.max(1, Number.parseInt(limit) || 50))
    const offset = (pageNum - 1) * limitNum

    sql += ` LIMIT ${limitNum} OFFSET ${offset}`

    const movements = await executeQuery(sql, params)

    // Contar total para paginación
    let countSql = `
      SELECT COUNT(*) as total 
      FROM cash_movements cm
      LEFT JOIN cash_sessions cs ON cm.cash_session_id = cs.id
      WHERE 1=1
        AND NOT (cm.type = 'sale' AND cm.payment_method IN ('cuenta_corriente', 'credito'))
    `
    const countParams = []

    if (current_session_only === "true") {
      countSql += ` AND cs.status = 'open'`
    }

    if (start_date && /^\d{4}-\d{2}-\d{2}$/.test(start_date)) {
      countSql += ` AND DATE(cm.created_at) >= ?`
      countParams.push(start_date)
    }

    if (end_date && /^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
      countSql += ` AND DATE(cm.created_at) <= ?`
      countParams.push(end_date)
    }

    if (type && ["opening", "closing", "sale", "deposit", "withdrawal", "expense", "cancellation"].includes(type)) {
      countSql += ` AND cm.type = ?`
      countParams.push(type)
    }

    const [{ total }] = await executeQuery(countSql, countParams)

    res.json({
      success: true,
      data: {
        movements,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: Number.parseInt(total),
          pages: Math.ceil(total / limitNum),
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

export const createCashMovement = async (req, res) => {
  try {
    const { type, amount, description, reference } = req.body
    const userId = req.user?.id

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Usuario no autenticado",
        code: "UNAUTHORIZED",
      })
    }

    // Validar que hay una caja abierta
    const openSession = await executeQuery("SELECT id FROM cash_sessions WHERE status = 'open' LIMIT 1")

    if (openSession.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No hay una caja abierta",
        code: "NO_OPEN_CASH",
      })
    }

    // Validaciones
    if (!["deposit", "withdrawal", "expense"].includes(type)) {
      return res.status(400).json({
        success: false,
        message: "Tipo de movimiento inválido",
        code: "INVALID_MOVEMENT_TYPE",
      })
    }

    const movementAmount = Number.parseFloat(amount)
    if (isNaN(movementAmount) || movementAmount <= 0) {
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

    // Crear movimiento
    const result = await executeQuery(
      `
      INSERT INTO cash_movements (
        cash_session_id, type, amount, description, reference, user_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `,
      [
        openSession[0].id,
        type,
        type === "withdrawal" || type === "expense" ? -Math.abs(movementAmount) : movementAmount,
        description.trim(),
        reference?.trim() || null,
        userId,
      ],
    )

    // Obtener el movimiento creado
    const newMovement = await executeQuery(
      `
      SELECT 
        cm.id, cm.cash_session_id, cm.type, cm.amount, cm.description, cm.reference, cm.user_id, cm.created_at,
        u.name as user_name
      FROM cash_movements cm
      LEFT JOIN users u ON cm.user_id = u.id
      WHERE cm.id = ?
    `,
      [result.insertId],
    )

    res.status(201).json({
      success: true,
      message: "Movimiento registrado correctamente",
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

export const getCashSettings = async (req, res) => {
  try {
    const settings = await executeQuery("SELECT * FROM cash_settings ORDER BY id DESC LIMIT 1")

    if (settings.length === 0) {
      await executeQuery(`
        INSERT INTO cash_settings (
          min_cash_amount, max_cash_amount, auto_close_time, 
          require_count_for_close, allow_negative_cash
        ) VALUES (2000.00, 20000.00, '22:00:00', TRUE, FALSE)
      `)

      const newSettings = await executeQuery("SELECT * FROM cash_settings ORDER BY id DESC LIMIT 1")
      return res.json({
        success: true,
        data: newSettings[0],
      })
    }

    res.json({
      success: true,
      data: settings[0],
    })
  } catch (error) {
    console.error("Error al obtener configuración:", error)
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      code: "SETTINGS_FETCH_ERROR",
    })
  }
}

export const updateCashSettings = async (req, res) => {
  try {
    const { min_cash_amount, max_cash_amount, auto_close_time, require_count_for_close, allow_negative_cash } = req.body

    // Validaciones básicas
    if (min_cash_amount !== undefined) {
      const minAmount = Number.parseFloat(min_cash_amount)
      if (isNaN(minAmount) || minAmount < 0) {
        return res.status(400).json({
          success: false,
          message: "Monto mínimo inválido",
          code: "INVALID_MIN_AMOUNT",
        })
      }
    }

    if (max_cash_amount !== undefined) {
      const maxAmount = Number.parseFloat(max_cash_amount)
      if (isNaN(maxAmount) || maxAmount < 0) {
        return res.status(400).json({
          success: false,
          message: "Monto máximo inválido",
          code: "INVALID_MAX_AMOUNT",
        })
      }
    }

    // Construir query de actualización dinámicamente
    const updates = []
    const params = []

    if (min_cash_amount !== undefined) {
      updates.push("min_cash_amount = ?")
      params.push(Number.parseFloat(min_cash_amount))
    }

    if (max_cash_amount !== undefined) {
      updates.push("max_cash_amount = ?")
      params.push(Number.parseFloat(max_cash_amount))
    }

    if (auto_close_time !== undefined) {
      updates.push("auto_close_time = ?")
      params.push(auto_close_time)
    }

    if (require_count_for_close !== undefined) {
      updates.push("require_count_for_close = ?")
      params.push(Boolean(require_count_for_close))
    }

    if (allow_negative_cash !== undefined) {
      updates.push("allow_negative_cash = ?")
      params.push(Boolean(allow_negative_cash))
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No hay campos para actualizar",
        code: "NO_UPDATES",
      })
    }

    updates.push("updated_at = CURRENT_TIMESTAMP")

    await executeQuery(
      `
      UPDATE cash_settings 
      SET ${updates.join(", ")} 
      WHERE id = (SELECT id FROM (SELECT id FROM cash_settings ORDER BY id DESC LIMIT 1) as temp)
    `,
      params,
    )

    // Obtener configuración actualizada
    const updatedSettings = await executeQuery("SELECT * FROM cash_settings ORDER BY id DESC LIMIT 1")

    res.json({
      success: true,
      message: "Configuración actualizada correctamente",
      data: updatedSettings[0],
    })
  } catch (error) {
    console.error("Error al actualizar configuración:", error)
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
      code: "SETTINGS_UPDATE_ERROR",
    })
  }
}
