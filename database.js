const sqlite3 = require('sqlite3').verbose();

class Database {
  constructor() {
    this.db = new sqlite3.Database('./bot.db');
    this.initDB();
  }

  initDB() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS users (
        user_id INTEGER PRIMARY KEY,
        username TEXT,
        balance INTEGER DEFAULT 0,
        total_spent INTEGER DEFAULT 0,
        rank TEXT DEFAULT 'Новичок',
        orders_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        game TEXT,
        item TEXT,
        amount INTEGER,
        player_id TEXT,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(user_id)
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        amount INTEGER,
        payment_id TEXT UNIQUE,
        status TEXT DEFAULT 'pending',
        proof_path TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(user_id)
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        rating INTEGER,
        text TEXT,
        game TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(user_id)
      )
    `);
  }

  addUser(userId, username) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT OR IGNORE INTO users (user_id, username) VALUES (?, ?)`,
        [userId, username],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  getUser(userId) {
    return new Promise((resolve, reject) => {
      this.db.get('SELECT * FROM users WHERE user_id = ?', [userId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  updateBalance(userId, amount, description = 'Пополнение баланса') {
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        this.db.run('BEGIN TRANSACTION');

        this.db.run(
          'UPDATE users SET balance = balance + ?, total_spent = total_spent + ? WHERE user_id = ?',
          [amount, amount, userId],
          (err) => {
            if (err) {
              this.db.run('ROLLBACK');
              reject(err);
              return;
            }

            this.db.run(
              'INSERT INTO orders (user_id, amount, description) VALUES (?, ?, ?)',
              [userId, amount, description],
              (err) => {
                if (err) {
                  this.db.run('ROLLBACK');
                  reject(err);
                  return;
                }

                this.db.run('COMMIT');
                resolve();
              }
            );
          }
        );
      });
    });
  }

  createPayment(userId, amount, paymentId) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'INSERT INTO payments (user_id, amount, payment_id) VALUES (?, ?, ?)',
        [userId, amount, paymentId],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  updatePaymentStatus(paymentId, status, proofPath = null) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'UPDATE payments SET status = ?, proof_path = ? WHERE payment_id = ?',
        [status, proofPath, paymentId],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  getOrderHistory(userId, limit = 5) {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
        [userId, limit],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  getRankInfo(totalSpent) {
    if (totalSpent >= 50000) {
      return {
        name: "Алмазный",
        icon: "💎",
        color: "#00FFFF",
        nextRank: null,
        required: 0
      };
    } else if (totalSpent >= 15000) {
      return {
        name: "Золотой",
        icon: "🥇",
        color: "#FFD700",
        nextRank: "Алмазный",
        required: 50000 - totalSpent
      };
    } else if (totalSpent >= 5000) {
      return {
        name: "Серебряный",
        icon: "🥈",
        color: "#C0C0C0",
        nextRank: "Золотой",
        required: 15000 - totalSpent
      };
    } else if (totalSpent >= 1000) {
      return {
        name: "Бронзовый",
        icon: "🥉",
        color: "#CD7F32",
        nextRank: "Серебряный",
        required: 5000 - totalSpent
      };
    } else {
      return {
        name: "Новичок",
        icon: "🪨",
        color: "#AAAAAA",
        nextRank: "Бронзовый",
        required: 1000 - totalSpent
      };
    }
  }

  getProgressBar(current, target) {
    const progress = Math.min((current / target) * 100, 100);
    const filled = Math.floor(progress / 10);
    return "🟢".repeat(filled) + "⚪".repeat(10 - filled);
  }

  getDailyStats() {
    return new Promise((resolve, reject) => {
      const today = new Date().toISOString().split('T')[0];
      this.db.get(
        `SELECT 
          COUNT(*) as orders_count,
          SUM(amount) as total_revenue,
          COUNT(DISTINCT user_id) as unique_users
        FROM orders 
        WHERE DATE(created_at) = ?`,
        [today],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
  }
}

module.exports = new Database(); 