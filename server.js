import express from "express"
import cors from "cors"
import dotenv from "dotenv"
import { testConnection } from "./src/config/database.js"

// Importar rutas
import authRoutes from "./src/routes/authRoutes.js"
import categoriesRoutes from "./src/routes/categoriesRoutes.js"
import productsRoutes from "./src/routes/productsRoutes.js"
import salesRoutes from "./src/routes/salesRoutes.js"
import customersRoutes from "./src/routes/customersRoutes.js"
import reportsRoutes from "./src/routes/reportsRoutes.js"
import cashRoutes from "./src/routes/cashRoutes.js"

// Configuración
dotenv.config()
const app = express()
const PORT = process.env.PORT || 5000

// Middleware de seguridad mejorado
app.use(
  cors({
    origin: "https://frontend-rho-woad-64.vercel.app",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
)

app.use(
  express.json({
    limit: "10mb",
    verify: (req, res, buf) => {
      try {
        JSON.parse(buf)
      } catch (e) {
        res.status(400).json({
          success: false,
          message: "JSON malformado en la solicitud",
          code: "INVALID_JSON",
        })
        return
      }
    },
  }),
)

app.use(express.urlencoded({ extended: true, limit: "10mb" }))

// Middleware de logging mejorado
if (process.env.NODE_ENV !== "production") {
  app.use((req, res, next) => {
    const timestamp = new Date().toISOString()
    const userAgent = req.get("User-Agent") || "Unknown"
    const ip = req.ip || req.connection.remoteAddress
    console.log(`[${timestamp}] ${req.method} ${req.path} - IP: ${ip} - UA: ${userAgent}`)
    next()
  })
}

// Middleware de rate limiting básico
const requestCounts = new Map()
const RATE_LIMIT_WINDOW = 60000 // 1 minuto
const RATE_LIMIT_MAX_REQUESTS = 100

app.use((req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress
  const now = Date.now()

  if (!requestCounts.has(ip)) {
    requestCounts.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW })
  } else {
    const clientData = requestCounts.get(ip)

    if (now > clientData.resetTime) {
      clientData.count = 1
      clientData.resetTime = now + RATE_LIMIT_WINDOW
    } else {
      clientData.count++

      if (clientData.count > RATE_LIMIT_MAX_REQUESTS) {
        return res.status(429).json({
          success: false,
          message: "Demasiadas solicitudes. Intente más tarde.",
          code: "RATE_LIMIT_EXCEEDED",
        })
      }
    }
  }

  next()
})

// Rutas de la API - CORREGIDO: Orden correcto y rutas de reportes en /api/reports
app.use("/api/auth", authRoutes)
app.use("/api/categories", categoriesRoutes)
app.use("/api/customers", customersRoutes)
app.use("/api/sales", salesRoutes)
app.use("/api/products", productsRoutes)
app.use("/api/reports", reportsRoutes) // CORREGIDO: Montar en /api/reports
app.use("/api/cash", cashRoutes) // AGREGADO: Ruta de cash

// Ruta de salud mejorada
app.get("/api/health", async (req, res) => {
  try {
    const dbConnected = await testConnection()

    res.json({
      success: true,
      message: "API funcionando correctamente",
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || "development",
      database: dbConnected ? "connected" : "disconnected",
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: "1.0.0",
    })
  } catch (error) {
    res.status(503).json({
      success: false,
      message: "Servicio no disponible",
      timestamp: new Date().toISOString(),
      error: error.message,
    })
  }
})

// Ruta por defecto mejorada
app.get("/", (req, res) => {
  res.json({
    message: "API Sistema de Ventas",
    version: "1.0.0",
    status: "active",
    endpoints: {
      auth: "/api/auth",
      categories: "/api/categories",
      products: "/api/products",
      sales: "/api/sales",
      customers: "/api/customers",
      reports: "/api/reports",
      cash: "/api/cash",
      health: "/api/health",
    },
    documentation: "/api/docs", // Para futura implementación
  })
})

// Middleware de manejo de errores mejorado
app.use((err, req, res, next) => {
  console.error("Error no manejado:", {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    timestamp: new Date().toISOString(),
  })

  // Error de JSON malformado
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({
      success: false,
      message: "JSON malformado en la solicitud",
      code: "INVALID_JSON",
    })
  }

  // Error de payload muy grande
  if (err.type === "entity.too.large") {
    return res.status(413).json({
      success: false,
      message: "El archivo es demasiado grande",
      code: "PAYLOAD_TOO_LARGE",
    })
  }

  // Error de timeout
  if (err.code === "ETIMEDOUT") {
    return res.status(408).json({
      success: false,
      message: "Tiempo de espera agotado",
      code: "REQUEST_TIMEOUT",
    })
  }

  // Error genérico
  res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === "production" ? "Error interno del servidor" : err.message,
    code: "INTERNAL_ERROR",
    ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
  })
})

// Middleware para rutas no encontradas
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    message: `Ruta no encontrada: ${req.method} ${req.originalUrl}`,
    code: "ROUTE_NOT_FOUND",
    availableEndpoints: [
      "/api/auth",
      "/api/categories",
      "/api/products",
      "/api/sales",
      "/api/customers",
      "/api/reports",
      "/api/cash",
      "/api/health",
    ],
  })
})

// Iniciar servidor con manejo de errores mejorado
const startServer = async () => {
  try {
    // Probar conexión a la base de datos
    console.log("🔍 Verificando conexión a la base de datos...")
    const dbConnected = await testConnection()

    if (!dbConnected) {
      console.error("❌ No se pudo conectar a la base de datos")
      console.error("💡 Verifique la configuración de la base de datos en las variables de entorno")
      process.exit(1)
    }

    // Iniciar servidor
    const server = app.listen(PORT, () => {
      console.log("🚀 Servidor iniciado exitosamente")
      console.log(`📍 URL: http://localhost:${PORT}`)
      console.log(`🔗 API: http://localhost:${PORT}/api`)
      console.log(`💚 Health: http://localhost:${PORT}/api/health`)
      console.log(`📊 Reports: http://localhost:${PORT}/api/reports`) // AGREGADO: Mostrar ruta de reportes
      console.log(`📊 Ambiente: ${process.env.NODE_ENV || "development"}`)
      console.log(`⏰ Iniciado: ${new Date().toISOString()}`)
    })

    // Configurar timeouts
    server.timeout = 30000 // 30 segundos
    server.keepAliveTimeout = 65000 // 65 segundos
    server.headersTimeout = 66000 // 66 segundos

    // Manejo de errores del servidor
    server.on("error", (error) => {
      if (error.code === "EADDRINUSE") {
        console.error(`❌ El puerto ${PORT} ya está en uso`)
        process.exit(1)
      } else {
        console.error("❌ Error del servidor:", error)
        process.exit(1)
      }
    })
  } catch (error) {
    console.error("❌ Error iniciando servidor:", error)
    process.exit(1)
  }
}

// Manejo de señales para cierre graceful
const gracefulShutdown = (signal) => {
  console.log(`🔄 Recibida señal ${signal}, cerrando servidor...`)

  // Limpiar recursos
  requestCounts.clear()

  // Cerrar servidor
  process.exit(0)
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"))
process.on("SIGINT", () => gracefulShutdown("SIGINT"))

// Manejo de errores no capturados
process.on("uncaughtException", (error) => {
  console.error("❌ Excepción no capturada:", error)
  console.error("🔄 Cerrando aplicación...")
  process.exit(1)
})

process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Promesa rechazada no manejada:", reason)
  console.error("🔍 En promesa:", promise)
  console.error("🔄 Cerrando aplicación...")
  process.exit(1)
})

startServer()
