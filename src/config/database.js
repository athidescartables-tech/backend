import mysql from "mysql2/promise"
import dotenv from "dotenv"

dotenv.config()

// Obtener la URL de conexión de la base de datos
const databaseUrl = process.env.MYSQL_PUBLIC_URL

if (!databaseUrl) {
  console.error("❌ Error: La variable de entorno MYSQL_PUBLIC_URL no está definida.")
  process.exit(1) // Salir si la URL no está configurada
}

// Crear pool de conexiones usando la URL
const pool = mysql.createPool(databaseUrl)

// Función para probar la conexión
export const testConnection = async () => {
  try {
    const connection = await pool.getConnection()
    console.log("✅ Conexión a MySQL establecida correctamente usando la URL.")
    connection.release()
    return true
  } catch (error) {
    console.error("❌ Error conectando a MySQL:", error.message)
    return false
  }
}

// Función para ejecutar queries
export const executeQuery = async (query, params = []) => {
  try {
    const [results] = await pool.execute(query, params)
    return results
  } catch (error) {
    console.error("Error ejecutando query:", error)
    console.error("Query:", query)
    console.error("Params:", params)
    throw error
  }
}

// Función para transacciones
export const executeTransaction = async (queries) => {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const results = []
    for (const { query, params } of queries) {
      const [result] = await connection.execute(query, params)
      results.push(result)
    }
    await connection.commit()
    return results
  } catch (error) {
    await connection.rollback()
    console.error("Error en transacción:", error)
    throw error
  } finally {
    connection.release()
  }
}

// Función para obtener estadísticas de la base de datos
export const getDatabaseStats = async () => {
  try {
    const [tables] = await pool.execute("SHOW TABLES")
    const stats = {}
    for (const table of tables) {
      const tableName = Object.values(table)[0]
      const [count] = await pool.execute(`SELECT COUNT(*) as count FROM ${tableName}`)
      stats[tableName] = count[0].count
    }
    return stats
  } catch (error) {
    console.error("Error obteniendo estadísticas:", error)
    return {}
  }
}

export default pool
