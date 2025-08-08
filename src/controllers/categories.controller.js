import { executeQuery } from "../config/database.js"

// Obtener todas las categorías
export const getCategories = async (req, res) => {
  try {
    const { active = "true", search } = req.query

    let sql = "SELECT * FROM categories WHERE 1=1"
    const params = []

    // Filtro por estado activo/inactivo
    if (active !== "all") {
      sql += " AND active = ?"
      params.push(active === "true")
    }

    // Filtro por búsqueda de texto
    if (search) {
      sql += " AND (name LIKE ? OR description LIKE ?)"
      const searchTerm = `%${search}%`
      params.push(searchTerm, searchTerm)
    }

    sql += " ORDER BY name ASC"

    const categories = await executeQuery(sql, params)

    res.json({
      success: true,
      data: categories,
    })
  } catch (error) {
    console.error("Error al obtener categorías:", error)
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
    })
  }
}

// Obtener categoría por ID
export const getCategoryById = async (req, res) => {
  try {
    const { id } = req.params

    const categories = await executeQuery("SELECT * FROM categories WHERE id = ?", [id])

    if (categories.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Categoría no encontrada",
      })
    }

    res.json({
      success: true,
      data: categories[0],
    })
  } catch (error) {
    console.error("Error al obtener categoría:", error)
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
    })
  }
}

// Crear nueva categoría
export const createCategory = async (req, res) => {
  try {
    const { name, description, color, icon } = req.body

    // Verificar si ya existe una categoría con el mismo nombre
    const existingCategory = await executeQuery("SELECT id FROM categories WHERE name = ?", [name])
    if (existingCategory.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Ya existe una categoría con este nombre",
      })
    }

    const sql = `
      INSERT INTO categories (name, description, color, icon)
      VALUES (?, ?, ?, ?)
    `

    const result = await executeQuery(sql, [name, description || null, color || "#3B82F6", icon || "📦"])

    // Obtener la categoría creada
    const newCategory = await executeQuery("SELECT * FROM categories WHERE id = ?", [result.insertId])

    res.status(201).json({
      success: true,
      message: "Categoría creada correctamente",
      data: newCategory[0],
    })
  } catch (error) {
    console.error("Error al crear categoría:", error)
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
    })
  }
}

// Actualizar categoría
export const updateCategory = async (req, res) => {
  try {
    const { id } = req.params
    const { name, description, color, icon, active } = req.body

    // Verificar si la categoría existe
    const existingCategory = await executeQuery("SELECT * FROM categories WHERE id = ?", [id])
    if (existingCategory.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Categoría no encontrada",
      })
    }

    // Verificar si ya existe otra categoría con el mismo nombre
    const duplicateName = await executeQuery("SELECT id FROM categories WHERE name = ? AND id != ?", [name, id])
    if (duplicateName.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Ya existe otra categoría con este nombre",
      })
    }

    const sql = `
      UPDATE categories 
      SET name = ?, description = ?, color = ?, icon = ?, active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `

    await executeQuery(sql, [
      name,
      description || null,
      color || "#3B82F6",
      icon || "📦",
      active !== undefined ? active : true,
      id,
    ])

    // Obtener la categoría actualizada
    const updatedCategory = await executeQuery("SELECT * FROM categories WHERE id = ?", [id])

    res.json({
      success: true,
      message: "Categoría actualizada correctamente",
      data: updatedCategory[0],
    })
  } catch (error) {
    console.error("Error al actualizar categoría:", error)
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
    })
  }
}

// Eliminar categoría (soft delete)
export const deleteCategory = async (req, res) => {
  try {
    const { id } = req.params

    // Verificar si la categoría existe
    const existingCategory = await executeQuery("SELECT * FROM categories WHERE id = ?", [id])
    if (existingCategory.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Categoría no encontrada",
      })
    }

    // Verificar si hay productos asociados
    const productsCount = await executeQuery(
      "SELECT COUNT(*) as count FROM products WHERE category_id = ? AND active = TRUE",
      [id],
    )
    if (productsCount[0].count > 0) {
      return res.status(400).json({
        success: false,
        message: `No se puede eliminar la categoría porque tiene ${productsCount[0].count} productos asociados`,
      })
    }

    // Soft delete
    await executeQuery("UPDATE categories SET active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [id])

    res.json({
      success: true,
      message: "Categoría eliminada correctamente",
    })
  } catch (error) {
    console.error("Error al eliminar categoría:", error)
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
    })
  }
}

// Restaurar categoría
export const restoreCategory = async (req, res) => {
  try {
    const { id } = req.params

    // Verificar si la categoría existe
    const existingCategory = await executeQuery("SELECT * FROM categories WHERE id = ?", [id])
    if (existingCategory.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Categoría no encontrada",
      })
    }

    // Restaurar
    await executeQuery("UPDATE categories SET active = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [id])

    // Obtener la categoría restaurada
    const restoredCategory = await executeQuery("SELECT * FROM categories WHERE id = ?", [id])

    res.json({
      success: true,
      message: "Categoría restaurada correctamente",
      data: restoredCategory[0],
    })
  } catch (error) {
    console.error("Error al restaurar categoría:", error)
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
    })
  }
}

// Obtener estadísticas de categorías
export const getCategoryStats = async (req, res) => {
  try {
    const stats = await executeQuery(`
      SELECT 
        COUNT(*) as total_categories,
        SUM(CASE WHEN active = TRUE THEN 1 ELSE 0 END) as active_categories,
        SUM(CASE WHEN active = FALSE THEN 1 ELSE 0 END) as inactive_categories
      FROM categories
    `)

    // Categorías con más productos
    const topCategories = await executeQuery(`
      SELECT 
        c.id,
        c.name,
        c.color,
        c.icon,
        COUNT(p.id) as product_count
      FROM categories c
      LEFT JOIN products p ON c.id = p.category_id AND p.active = TRUE
      WHERE c.active = TRUE
      GROUP BY c.id, c.name, c.color, c.icon
      ORDER BY product_count DESC
      LIMIT 5
    `)

    res.json({
      success: true,
      data: {
        general: stats[0],
        top_categories: topCategories,
      },
    })
  } catch (error) {
    console.error("Error al obtener estadísticas:", error)
    res.status(500).json({
      success: false,
      message: "Error interno del servidor",
    })
  }
}
