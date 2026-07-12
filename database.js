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

  // 2. Tickets Table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_number TEXT NOT NULL,
      service_type TEXT NOT NULL CHECK(service_type IN ('Licensing', 'Registration', 'Miscellaneous')),
      status TEXT NOT NULL CHECK(status IN ('waiting', 'serving', 'completed', 'skipped')),
      counter_number INTEGER,
      called_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      called_at DATETIME,
      completed_at DATETIME,
      FOREIGN KEY (called_by) REFERENCES users (id)
    )
  `);

  // Seed default accounts if users table is empty
  const userCount = await dbGet('SELECT COUNT(*) as count FROM users');
  if (userCount.count === 0) {
    console.log('Seeding default user accounts...');
    const saltRounds = 10;
    
    const adminHash = await bcrypt.hash('admin123', saltRounds);
    const staff1Hash = await bcrypt.hash('staff123', saltRounds);
    const staff2Hash = await bcrypt.hash('staff123', saltRounds);
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
      ['reception', receptionHash, 'reception', 'Reception Kiosk']
    );
    console.log('Default accounts seeded successfully.');
  }
}

module.exports = {
  initDatabase,
  dbRun,
  dbGet,
  dbAll
};
