require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');

const { initDatabase, dbRun, dbGet, dbAll } = require('./database');
const { printTicket } = require('./printer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize database schema
initDatabase()
  .then(() => {
    console.log('Database initialized successfully.');
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });

// --- SOCKET.IO EVENTS ---
io.on('connection', (socket) => {
  console.log('A client connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Helper: Broadcast queue update
function broadcastQueueUpdate() {
  io.emit('queue-updated');
}

// --- AUTHENTICATION API ---
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const user = await dbGet('SELECT * FROM users WHERE username = ?', [username]);
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Success - return user details (excluding password)
    res.json({
      id: user.id,
      username: user.username,
      role: user.role,
      fullname: user.fullname
    });
  } catch (err) {
    res.status(500).json({ error: 'Database error during login' });
  }
});

// --- RECEPTION API (Ticket Generation) ---
app.post('/api/tickets', async (req, res) => {
  const { service_type } = req.body;
  
  if (!service_type || !['Licensing', 'Registration', 'Miscellaneous'].includes(service_type)) {
    return res.status(400).json({ error: 'Invalid service type' });
  }

  // Map service type to prefix
  const prefixes = {
    'Licensing': 'L',
    'Registration': 'R',
    'Miscellaneous': 'M'
  };
  const prefix = prefixes[service_type];

  try {
    // Get last ticket for this service created today (local time)
    // We use date('now', 'localtime') to match the server local timezone
    const lastTicket = await dbGet(
      `SELECT ticket_number FROM tickets 
       WHERE ticket_number LIKE ? 
         AND date(created_at, 'localtime') = date('now', 'localtime')
       ORDER BY id DESC LIMIT 1`,
      [`${prefix}-%`]
    );

    let nextNum = 101; // Start ticket numbers at 101
    if (lastTicket) {
      const parts = lastTicket.ticket_number.split('-');
      if (parts.length === 2) {
        const lastNum = parseInt(parts[1], 10);
        if (!isNaN(lastNum)) {
          nextNum = lastNum + 1;
        }
      }
    }

    const ticketNumber = `${prefix}-${nextNum}`;

    const result = await dbRun(
      `INSERT INTO tickets (ticket_number, service_type, status) VALUES (?, ?, 'waiting')`,
      [ticketNumber, service_type]
    );

    const newTicket = {
      id: result.id,
      ticket_number: ticketNumber,
      service_type,
      status: 'waiting',
      created_at: new Date().toISOString()
    };

    // Print ticket
    printTicket(newTicket);

    // Notify clients of a new ticket
    io.emit('ticket-created', newTicket);
    broadcastQueueUpdate();

    res.json(newTicket);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate ticket' });
  }
});

// --- DISPLAY SCREEN API ---
// Fetch active calls (currently serving tickets across all counters)
app.get('/api/display/active-calls', async (req, res) => {
  try {
    const activeCalls = await dbAll(
      `SELECT t.*, u.fullname as staff_name 
       FROM tickets t 
       LEFT JOIN users u ON t.called_by = u.id
       WHERE t.status = 'serving'
       ORDER BY t.called_at DESC`
    );
    res.json(activeCalls);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch active calls' });
  }
});

// Fetch waiting tickets
app.get('/api/display/waiting-queue', async (req, res) => {
  try {
    const waitingQueue = await dbAll(
      `SELECT ticket_number, service_type FROM tickets 
       WHERE status = 'waiting' 
         AND date(created_at, 'localtime') = date('now', 'localtime')
       ORDER BY id ASC LIMIT 10`
    );
    res.json(waitingQueue);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch waiting queue' });
  }
});

// --- STAFF DASHBOARD API ---
// Call Next Ticket
app.post('/api/counter/call-next', async (req, res) => {
  const { counter_number, user_id, services } = req.body;

  if (!counter_number || !user_id || !services || !Array.isArray(services) || services.length === 0) {
    return res.status(400).json({ error: 'Invalid staff request parameters' });
  }

  try {
    // 1. Auto-complete any existing tickets this user is currently serving
    await dbRun(
      `UPDATE tickets 
       SET status = 'completed', completed_at = CURRENT_TIMESTAMP 
       WHERE called_by = ? AND status = 'serving'`,
      [user_id]
    );

    // 2. Find the next waiting ticket matching the handled services
    // Use place-holders dynamically based on service count
    const placeholders = services.map(() => '?').join(',');
    const query = `
      SELECT * FROM tickets 
      WHERE status = 'waiting' 
        AND service_type IN (${placeholders})
        AND date(created_at, 'localtime') = date('now', 'localtime')
      ORDER BY id ASC LIMIT 1
    `;

    const nextTicket = await dbGet(query, services);

    if (!nextTicket) {
      broadcastQueueUpdate();
      return res.json({ message: 'No tickets waiting for your services', ticket: null });
    }

    // 3. Update the ticket to serving status
    await dbRun(
      `UPDATE tickets 
       SET status = 'serving', counter_number = ?, called_by = ?, called_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [counter_number, user_id, nextTicket.id]
    );

    // Fetch updated ticket with user name
    const updatedTicket = await dbGet(
      `SELECT t.*, u.fullname as staff_name 
       FROM tickets t 
       LEFT JOIN users u ON t.called_by = u.id 
       WHERE t.id = ?`,
      [nextTicket.id]
    );

    // Broadcast the announcement event to trigger chime + voice synthesis on TV Screen
    io.emit('ticket-called', {
      ticket_number: updatedTicket.ticket_number,
      counter_number: updatedTicket.counter_number,
      service_type: updatedTicket.service_type
    });

    broadcastQueueUpdate();
    res.json({ ticket: updatedTicket });
  } catch (err) {
    res.status(500).json({ error: 'Failed to call next ticket' });
  }
});

// Recall Ticket
app.post('/api/counter/recall', async (req, res) => {
  const { ticket_id } = req.body;

  if (!ticket_id) {
    return res.status(400).json({ error: 'Ticket ID is required' });
  }

  try {
    const ticket = await dbGet(
      `SELECT t.*, u.fullname as staff_name 
       FROM tickets t 
       LEFT JOIN users u ON t.called_by = u.id 
       WHERE t.id = ? AND t.status = 'serving'`,
      [ticket_id]
    );

    if (!ticket) {
      return res.status(404).json({ error: 'Active ticket not found' });
    }

    // Re-broadcast ticket announcement for display screen
    io.emit('ticket-called', {
      ticket_number: ticket.ticket_number,
      counter_number: ticket.counter_number,
      service_type: ticket.service_type
    });

    res.json({ success: true, message: 'Ticket recalled' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to recall ticket' });
  }
});

// Skip Ticket
app.post('/api/counter/skip', async (req, res) => {
  const { ticket_id } = req.body;

  if (!ticket_id) {
    return res.status(400).json({ error: 'Ticket ID is required' });
  }

  try {
    await dbRun(
      `UPDATE tickets 
       SET status = 'skipped', completed_at = CURRENT_TIMESTAMP 
       WHERE id = ? AND status = 'serving'`,
      [ticket_id]
    );

    broadcastQueueUpdate();
    res.json({ success: true, message: 'Ticket marked as skipped' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to skip ticket' });
  }
});

// Complete Ticket
app.post('/api/counter/complete', async (req, res) => {
  const { ticket_id } = req.body;

  if (!ticket_id) {
    return res.status(400).json({ error: 'Ticket ID is required' });
  }

  try {
    await dbRun(
      `UPDATE tickets 
       SET status = 'completed', completed_at = CURRENT_TIMESTAMP 
       WHERE id = ? AND status = 'serving'`,
      [ticket_id]
    );

    broadcastQueueUpdate();
    res.json({ success: true, message: 'Ticket completed' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to complete ticket' });
  }
});

// Fetch current active ticket for a staff member (in case of page refresh)
app.get('/api/counter/active/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const activeTicket = await dbGet(
      `SELECT * FROM tickets WHERE called_by = ? AND status = 'serving' LIMIT 1`,
      [userId]
    );
    res.json(activeTicket || null);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch active ticket' });
  }
});


// --- ADMIN API ---

// Admin User Management
app.get('/api/admin/users', async (req, res) => {
  try {
    const users = await dbAll('SELECT id, username, role, fullname FROM users');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load users' });
  }
});

app.post('/api/admin/users', async (req, res) => {
  const { username, password, role, fullname } = req.body;

  if (!username || !password || !role || !fullname) {
    return res.status(400).json({ error: 'All user fields are required' });
  }

  if (!['admin', 'staff', 'reception'].includes(role)) {
    return res.status(400).json({ error: 'Invalid user role' });
  }

  try {
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const result = await dbRun(
      `INSERT INTO users (username, password, role, fullname) VALUES (?, ?, ?, ?)`,
      [username, hashedPassword, role, fullname]
    );

    res.json({
      id: result.id,
      username,
      role,
      fullname
    });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    res.status(500).json({ error: 'Failed to create user' });
  }
});

app.delete('/api/admin/users/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // Don't allow deleting admin
    const user = await dbGet('SELECT username FROM users WHERE id = ?', [id]);
    if (user && user.username === 'admin') {
      return res.status(400).json({ error: 'Cannot delete the primary administrator' });
    }

    await dbRun('DELETE FROM users WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Analytics Dashboard Statistics
app.get('/api/admin/stats', async (req, res) => {
  try {
    // 1. Total served today
    const servedToday = await dbGet(
      `SELECT COUNT(*) as count FROM tickets 
       WHERE status = 'completed' 
         AND date(completed_at, 'localtime') = date('now', 'localtime')`
    );

    // 2. Average wait time today (waiting state to serving state in minutes)
    // We check tickets called today
    const avgWait = await dbGet(
      `SELECT AVG(strftime('%s', called_at) - strftime('%s', created_at)) as seconds 
       FROM tickets 
       WHERE called_at IS NOT NULL 
         AND date(called_at, 'localtime') = date('now', 'localtime')`
    );

    // 3. Average service time today (serving state to completed state in minutes)
    const avgService = await dbGet(
      `SELECT AVG(strftime('%s', completed_at) - strftime('%s', called_at)) as seconds 
       FROM tickets 
       WHERE status = 'completed'
         AND completed_at IS NOT NULL 
         AND called_at IS NOT NULL
         AND date(completed_at, 'localtime') = date('now', 'localtime')`
    );

    // 4. Ticket status counts by service type (waiting, serving, completed, skipped)
    const statusCounts = await dbAll(
      `SELECT service_type, status, COUNT(*) as count 
       FROM tickets 
       WHERE date(created_at, 'localtime') = date('now', 'localtime')
       GROUP BY service_type, status`
    );

    // 5. Hourly ticket volume (Peak hours today)
    const hourlyVolume = await dbAll(
      `SELECT strftime('%H:00', created_at, 'localtime') as hour, COUNT(*) as count 
       FROM tickets 
       WHERE date(created_at, 'localtime') = date('now', 'localtime')
       GROUP BY hour 
       ORDER BY hour ASC`
    );

    // Format metrics
    const formatMinutes = (seconds) => {
      if (!seconds) return '0m 0s';
      const mins = Math.floor(seconds / 60);
      const secs = Math.round(seconds % 60);
      return `${mins}m ${secs}s`;
    };

    res.json({
      metrics: {
        servedToday: servedToday.count || 0,
        avgWaitTime: formatMinutes(avgWait.seconds),
        avgServiceTime: formatMinutes(avgService.seconds)
      },
      statusCounts,
      hourlyVolume
    });
  } catch (err) {
    console.error('Error fetching admin stats:', err);
    res.status(500).json({ error: 'Failed to load statistics' });
  }
});

// Reset Today's Queue (Marks waiting/serving tickets as skipped for today to clean up the board)
app.post('/api/admin/reset-queue', async (req, res) => {
  try {
    // We mark any waiting or serving tickets created today as 'skipped' so the active queue clears
    await dbRun(
      `UPDATE tickets 
       SET status = 'skipped', completed_at = CURRENT_TIMESTAMP 
       WHERE status IN ('waiting', 'serving') 
         AND date(created_at, 'localtime') = date('now', 'localtime')`
    );

    broadcastQueueUpdate();
    io.emit('queue-reset');

    res.json({ success: true, message: "Today's queue cleared successfully." });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reset queue' });
  }
});

server.listen(PORT, () => {
  console.log(`LTO Queuing System Server running on http://localhost:${PORT}`);
});
