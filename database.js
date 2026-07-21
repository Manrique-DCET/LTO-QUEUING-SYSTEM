const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

// Helper functions to wrap sqlite3 callbacks in Promises
const dbRun = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) {
        console.error('Database run error:', err, 'SQL:', sql);
        reject(err);
      } else {
        resolve({ id: this.lastID, changes: this.changes });
      }
    });
  });
};

const dbGet = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        console.error('Database get error:', err, 'SQL:', sql);
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
};

const dbAll = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        console.error('Database all error:', err, 'SQL:', sql);
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
};

// Initialize database schema
async function initDatabase() {
  console.log('Initializing database tables...');

  // 1. Users Table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'staff', 'reception')),
      fullname TEXT NOT NULL
    )
  `);

  // 2. Tickets Table Migration/Setup
  const tableInfo = await dbGet("SELECT sql FROM sqlite_master WHERE type='table' AND name='tickets'");
  if (tableInfo && !tableInfo.sql.includes('Settlement')) {
    console.log('Migrating tickets table to support Settlement and Query services...');
    try {
      await dbRun('ALTER TABLE tickets RENAME TO tickets_old');
      await dbRun(`
        CREATE TABLE tickets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ticket_number TEXT NOT NULL,
          service_type TEXT NOT NULL CHECK(service_type IN ('Licensing', 'Registration', 'Miscellaneous', 'Settlement', 'Query')),
          status TEXT NOT NULL CHECK(status IN ('waiting', 'serving', 'completed', 'skipped')),
          counter_number INTEGER,
          called_by INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          called_at DATETIME,
          completed_at DATETIME,
          FOREIGN KEY (called_by) REFERENCES users (id)
        )
      `);
      await dbRun(`
        INSERT INTO tickets (id, ticket_number, service_type, status, counter_number, called_by, created_at, called_at, completed_at)
        SELECT id, ticket_number, service_type, status, counter_number, called_by, created_at, called_at, completed_at
        FROM tickets_old
      `);
      await dbRun('DROP TABLE tickets_old');
      console.log('Tickets table migrated successfully.');
    } catch (migrationErr) {
      console.error('Migration failed, attempting rollback/cleanup:', migrationErr);
      try {
        await dbRun('DROP TABLE IF EXISTS tickets');
        await dbRun('ALTER TABLE tickets_old RENAME TO tickets');
      } catch (rollbackErr) {
        console.error('Rollback failed:', rollbackErr);
      }
    }
  }

  await dbRun(`
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_number TEXT NOT NULL,
      service_type TEXT NOT NULL CHECK(service_type IN ('Licensing', 'Registration', 'Miscellaneous', 'Settlement', 'Query')),
      concern TEXT,
      assigned_window INTEGER,
      status TEXT NOT NULL CHECK(status IN ('waiting', 'serving', 'completed', 'skipped')),
      counter_number INTEGER,
      called_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      called_at DATETIME,
      completed_at DATETIME,
      FOREIGN KEY (called_by) REFERENCES users (id)
    )
  `);

  // Check and add concern and assigned_window columns if missing for existing databases
  const ticketsTableInfo = await dbAll("PRAGMA table_info(tickets)");
  if (ticketsTableInfo && ticketsTableInfo.length > 0) {
    const hasConcern = ticketsTableInfo.some(col => col.name === 'concern');
    if (!hasConcern) {
      console.log('Migrating tickets table to add concern column...');
      await dbRun('ALTER TABLE tickets ADD COLUMN concern TEXT');
    }
    const hasAssignedWindow = ticketsTableInfo.some(col => col.name === 'assigned_window');
    if (!hasAssignedWindow) {
      console.log('Migrating tickets table to add assigned_window column...');
      await dbRun('ALTER TABLE tickets ADD COLUMN assigned_window INTEGER');
    }
  }

  // Seed default accounts if users table is empty
  const userCount = await dbGet('SELECT COUNT(*) as count FROM users');
  if (userCount.count === 0) {
    console.log('Seeding default user accounts...');
    const saltRounds = 10;
    
    const adminHash = await bcrypt.hash('admin123', saltRounds);
    const staff1Hash = await bcrypt.hash('staff123', saltRounds);
    const staff2Hash = await bcrypt.hash('staff123', saltRounds);
    const cashier1Hash = await bcrypt.hash('cashier123', saltRounds);
    const cashier2Hash = await bcrypt.hash('cashier123', saltRounds);
    const receptionHash = await bcrypt.hash('reception123', saltRounds);

    await dbRun(
      'INSERT INTO users (username, password, role, fullname) VALUES (?, ?, ?, ?)',
      ['admin', adminHash, 'admin', 'System Administrator']
    );
    await dbRun(
      'INSERT INTO users (username, password, role, fullname) VALUES (?, ?, ?, ?)',
      ['staff1', staff1Hash, 'staff', 'Counter Staff 1']
    );
    await dbRun(
      'INSERT INTO users (username, password, role, fullname) VALUES (?, ?, ?, ?)',
      ['staff2', staff2Hash, 'staff', 'Counter Staff 2']
    );
    await dbRun(
      'INSERT INTO users (username, password, role, fullname) VALUES (?, ?, ?, ?)',
      ['cashier1', cashier1Hash, 'staff', 'Licensing Cashier (Window 3)']
    );
    await dbRun(
      'INSERT INTO users (username, password, role, fullname) VALUES (?, ?, ?, ?)',
      ['cashier2', cashier2Hash, 'staff', 'Main Cashier (Window 8)']
    );
    await dbRun(
      'INSERT INTO users (username, password, role, fullname) VALUES (?, ?, ?, ?)',
      ['reception', receptionHash, 'reception', 'Reception Kiosk']
    );
    console.log('Default accounts seeded successfully.');
  } else {
    // Ensure cashier accounts exist in database
    const cashier1 = await dbGet("SELECT id FROM users WHERE username = 'cashier1'");
    if (!cashier1) {
      const saltRounds = 10;
      const cashier1Hash = await bcrypt.hash('cashier123', saltRounds);
      await dbRun(
        'INSERT INTO users (username, password, role, fullname) VALUES (?, ?, ?, ?)',
        ['cashier1', cashier1Hash, 'staff', 'Licensing Cashier (Window 3)']
      );
    }
    const cashier2 = await dbGet("SELECT id FROM users WHERE username = 'cashier2'");
    if (!cashier2) {
      const saltRounds = 10;
      const cashier2Hash = await bcrypt.hash('cashier123', saltRounds);
      await dbRun(
        'INSERT INTO users (username, password, role, fullname) VALUES (?, ?, ?, ?)',
        ['cashier2', cashier2Hash, 'staff', 'Main Cashier (Window 8)']
      );
    }
  }
}

module.exports = {
  initDatabase,
  dbRun,
  dbGet,
  dbAll
};
