import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

// Si tenés en .env: MYSQL_PUBLIC_URL="mysql://user:pass@host:3306/dbname"
const MYSQL_PUBLIC_URL = process.env.MYSQL_PUBLIC_URL;

// Configuración de la base de datos (valores por defecto si no usás MYSQL_PUBLIC_URL)
const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  port: Number.parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "sistema_ventas",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

// Crear pool de conexiones
let pool;
if (MYSQL_PUBLIC_URL) {
  // Usar únicamente la URI pública cuando esté definida, pero mantener opciones del pool
  try {
    // Intentamos crear el pool con la URI y opciones (mysql2 soporta createPool(obj) con uri en algunos entornos)
    pool = mysql.createPool({
      uri: MYSQL_PUBLIC_URL,
      waitForConnections: dbConfig.waitForConnections,
      connectionLimit: dbConfig.connectionLimit,
      queueLimit: dbConfig.queueLimit,
    });
  } catch (err) {
    // Fallback: crear pool pasando la URI como string directamente
    try {
      pool = mysql.createPool(MYSQL_PUBLIC_URL);
    } catch (err2) {
      console.error("❌ Error al crear el pool usando MYSQL_PUBLIC_URL:", err2.message);
      process.exit(1);
    }
  }
} else {
  // Si no existe MYSQL_PUBLIC_URL, usar la configuración por host/port tradicional (no rompe compatibilidad)
  pool = mysql.createPool(dbConfig);
}

// Helper para parsear la URI sólo para logs (no afecta la conexión)
const parseMysqlUri = (uri) => {
  try {
    const prefixed = uri.match(/^[a-zA-Z]+:\/\//) ? uri : `mysql://${uri}`;
    const url = new URL(prefixed);
    const host = url.hostname + (url.port ? `:${url.port}` : "");
    const database = url.pathname ? url.pathname.replace(/^\//, "") : "";
    const user = url.username || null;
    return { host, database, user };
  } catch (e) {
    return null;
  }
};

const connectionInfo = MYSQL_PUBLIC_URL ? parseMysqlUri(MYSQL_PUBLIC_URL) : null;

// Función para probar la conexión
export const testConnection = async () => {
  try {
    const connection = await pool.getConnection();
    console.log("✅ Conexión a MySQL establecida correctamente");

    if (MYSQL_PUBLIC_URL && connectionInfo) {
      console.log(`📊 Base de datos: ${connectionInfo.database || "<no disponible en URI>"}`);
      console.log(`🌐 Host: ${connectionInfo.host || "<no disponible en URI>"}`);
      if (connectionInfo.user) console.log(`👤 Usuario: ${connectionInfo.user}`);
    } else {
      console.log(`📊 Base de datos: ${dbConfig.database}`);
      console.log(`🌐 Host: ${dbConfig.host}:${dbConfig.port}`);
    }

    connection.release();
    return true;
  } catch (error) {
    console.error("❌ Error conectando a MySQL:", error.message);
    console.error("💡 Verifique la configuración de la base de datos en las variables de entorno");
    // En producción, es crucial que la app no continúe si no hay conexión a la DB
    process.exit(1); 
  }
};

// Función para ejecutar una consulta SQL

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

// Función para ejecutar una transacción SQL
export const executeTransaction = async (queries) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const results = [];
    for (const { query, params } of queries) {
      const [result] = await connection.execute(query, params);
      results.push(result);
    }

    await connection.commit();
    return results;
  } catch (error) {
    await connection.rollback();
    console.error("Error en transacción:", error);
    throw error;
  } finally {
    connection.release();
  }
};

// Función para obtener estadísticas de la base de datos
export const getDatabaseStats = async () => {
  try {
    const [tables] = await pool.execute("SHOW TABLES");
    const stats = {};

    for (const table of tables) {
      const tableName = Object.values(table)[0];
      const [count] = await pool.execute(`SELECT COUNT(*) as count FROM \`${tableName}\``);
      stats[tableName] = count[0].count;
    }

    return stats;
  } catch (error) {
    console.error("Error obteniendo estadísticas:", error);
    return {};
  }
};

export default pool;
