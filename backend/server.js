const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Enhanced CORS configuration for production
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'http://localhost:3000',
      'https://attendance-tracker-frontend.vercel.app',
      'https://attendance-tracker.vercel.app',
      process.env.FRONTEND_URL
    ].filter(Boolean); // Remove any undefined values
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('Blocked by CORS:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Handle preflight requests
app.options('*', cors(corsOptions));

// Database configuration with connection pooling
const dbConfig = {
    host: process.env.DB_HOST || 'sql10.freesqldatabase.com',
    user: process.env.DB_USER || 'sql10805222',
    password: process.env.DB_PASSWORD || 'ERSKtLerkH',
    database: process.env.DB_NAME || 'sql10805222',
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    acquireTimeout: 60000,
    timeout: 60000,
    reconnect: true
};

// Create database connection pool
let pool;

async function initDatabase() {
    try {
        pool = mysql.createPool(dbConfig);
        
        // Test connection
        const connection = await pool.getConnection();
        console.log('✅ Connected to database successfully');
        
        // Create table if it doesn't exist
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS Attendance (
                id INT AUTO_INCREMENT PRIMARY KEY,
                employeeName VARCHAR(255) NOT NULL,
                employeeID VARCHAR(100) NOT NULL,
                date DATE NOT NULL,
                status ENUM('Present', 'Absent') NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Attendance table verified/created');
        
        connection.release();
        return true;
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        console.error('Database config:', {
            host: dbConfig.host,
            user: dbConfig.user,
            database: dbConfig.database,
            port: dbConfig.port
        });
        return false;
    }
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'OK', 
        message: 'Server is running',
        timestamp: new Date().toISOString()
    });
});

// API info endpoint
app.get('/api', (req, res) => {
    res.json({ 
        message: 'Employee Attendance Tracker API',
        version: '1.0.0',
        endpoints: {
            'GET /api/attendance': 'Get all attendance records',
            'POST /api/attendance': 'Create new attendance record',
            'DELETE /api/attendance/:id': 'Delete attendance record'
        }
    });
});

// Routes

// GET all attendance records
app.get('/api/attendance', async (req, res) => {
    try {
        if (!pool) {
            return res.status(500).json({ error: 'Database not connected' });
        }

        const [rows] = await pool.execute(`
            SELECT * FROM Attendance 
            ORDER BY date DESC, created_at DESC
        `);
        
        res.json({
            success: true,
            data: rows,
            count: rows.length
        });
    } catch (error) {
        console.error('Error fetching attendance:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to fetch attendance records',
            details: error.message 
        });
    }
});

// POST new attendance record
app.post('/api/attendance', async (req, res) => {
    try {
        if (!pool) {
            return res.status(500).json({ error: 'Database not connected' });
        }

        const { employeeName, employeeID, date, status } = req.body;
        
        // Validation
        if (!employeeName || !employeeID || !date || !status) {
            return res.status(400).json({ 
                success: false,
                error: 'All fields are required: employeeName, employeeID, date, status' 
            });
        }
        
        if (!['Present', 'Absent'].includes(status)) {
            return res.status(400).json({ 
                success: false,
                error: 'Status must be "Present" or "Absent"' 
            });
        }

        // Validate date format
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(date)) {
            return res.status(400).json({
                success: false,
                error: 'Date must be in YYYY-MM-DD format'
            });
        }
        
        const [result] = await pool.execute(
            'INSERT INTO Attendance (employeeName, employeeID, date, status) VALUES (?, ?, ?, ?)',
            [employeeName.trim(), employeeID.trim(), date, status]
        );
        
        res.status(201).json({ 
            success: true,
            message: 'Attendance recorded successfully', 
            id: result.insertId,
            data: { employeeName, employeeID, date, status }
        });
    } catch (error) {
        console.error('Error recording attendance:', error);
        
        // Handle duplicate entry or other MySQL errors
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({
                success: false,
                error: 'Duplicate entry found'
            });
        }
        
        res.status(500).json({ 
            success: false,
            error: 'Failed to record attendance',
            details: error.message 
        });
    }
});

// DELETE attendance record (Bonus)
app.delete('/api/attendance/:id', async (req, res) => {
    try {
        if (!pool) {
            return res.status(500).json({ error: 'Database not connected' });
        }

        const { id } = req.params;
        
        // Validate ID
        if (!id || isNaN(id)) {
            return res.status(400).json({
                success: false,
                error: 'Valid ID is required'
            });
        }
        
        const [result] = await pool.execute(
            'DELETE FROM Attendance WHERE id = ?',
            [parseInt(id)]
        );
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ 
                success: false,
                error: 'Record not found' 
            });
        }
        
        res.json({ 
            success: true,
            message: 'Record deleted successfully' 
        });
    } catch (error) {
        console.error('Error deleting record:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to delete record',
            details: error.message 
        });
    }
});

// 404 handler for undefined routes
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        error: `Route ${req.originalUrl} not found`
    });
});

// Global error handler
app.use((error, req, res, next) => {
    console.error('Global error handler:', error);
    res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message
    });
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down gracefully...');
    if (pool) {
        await pool.end();
    }
    process.exit(0);
});

// Start server with retry logic
async function startServer() {
    const maxRetries = 3;
    let retries = 0;
    
    while (retries < maxRetries) {
        const dbConnected = await initDatabase();
        
        if (dbConnected) {
            app.listen(PORT, () => {
                console.log(`🚀 Server running on port ${PORT}`);
                console.log(`📊 Database: ${dbConfig.database}@${dbConfig.host}`);
                console.log(`🌐 Health check: http://localhost:${PORT}/health`);
                console.log(`🔗 API: http://localhost:${PORT}/api`);
            });
            break;
        } else {
            retries++;
            console.log(`Retrying database connection... (${retries}/${maxRetries})`);
            if (retries < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
            } else {
                console.error('❌ Failed to connect to database after multiple attempts');
                process.exit(1);
            }
        }
    }
}

startServer();