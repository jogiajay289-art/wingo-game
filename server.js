const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

// Crash Logger - Writes errors to error_log.txt if the server fails to start
process.on('uncaughtException', (err) => {
    const errorMsg = `\x0a[${new Date().toISOString()}] UNCAUGHT EXCEPTION: ${err.stack}\x0a`;
    console.error(errorMsg);
    fs.appendFileSync(path.join(__dirname, 'error_log.txt'), errorMsg);
    // Give time for file write before exit
    setTimeout(() => process.exit(1), 500);
});

process.on('unhandledRejection', (reason, promise) => {
    const errorMsg = `\x0a[${new Date().toISOString()}] UNHANDLED REJECTION: ${reason}\x0a`;
    console.error(errorMsg);
    fs.appendFileSync(path.join(__dirname, 'error_log.txt'), errorMsg);
});

const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});
const PORT = process.env.PORT || 5555;

// Middleware
// Middleware - Explicitly permissive CORS for all local environments
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
    credentials: true
}));
app.use(express.json());

// Serve the static frontend
app.use(express.static(path.join(__dirname, 'client')));

// CSV File Paths
const CSV_FILE_PATH = path.join(__dirname, 'database', 'user_information.csv');
const REVENUE_FILE_PATH = path.join(__dirname, 'database', 'platform_revenue.csv');
const RECHARGES_FILE_PATH = path.join(__dirname, 'database', 'recharges.csv');
const WITHDRAWALS_FILE_PATH = path.join(__dirname, 'database', 'withdrawals.csv');
const SETTINGS_FILE_PATH = path.join(__dirname, 'database', 'settings.json');
const ALERTS_FILE_PATH = path.join(__dirname, 'database', 'admin_alerts.txt');

// Health Check / Diagnostics
app.get('/api/ping', (req, res) => {
    res.status(200).json({ status: 'ok', server: 'Wingo Backend', version: '1.2' });
});

app.get('/api/diag', (req, res) => {
    const diag = {
        time: new Date().toISOString(),
        db_exists: fs.existsSync(CSV_FILE_PATH),
        db_path: CSV_FILE_PATH,
        port: PORT,
        uptime: process.uptime()
    };
    res.status(200).json(diag);
});

// Initialize Files if not exists
if (!fs.existsSync(path.join(__dirname, 'database'))) {
    fs.mkdirSync(path.join(__dirname, 'database'));
}
if (!fs.existsSync(CSV_FILE_PATH)) {
    fs.writeFileSync(CSV_FILE_PATH, 'id,phoneNumber,password,role,balance,createdAt\n');
}
if (!fs.existsSync(REVENUE_FILE_PATH)) {
    fs.writeFileSync(REVENUE_FILE_PATH, 'Timestamp,Type,Amount,Description\n');
}
if (!fs.existsSync(RECHARGES_FILE_PATH)) {
    fs.writeFileSync(RECHARGES_FILE_PATH, 'id,userId,userName,amount,upiId,status,timestamp\n');
}
if (!fs.existsSync(WITHDRAWALS_FILE_PATH)) {
    fs.writeFileSync(WITHDRAWALS_FILE_PATH, 'id,userId,userName,amount,upiId,status,timestamp\n');
}

// Function to log commission/revenue
function logRevenue(type, amount, description) {
    const entry = `${new Date().toISOString()},${type},${amount},"${description}"\n`;
    fs.appendFile(REVENUE_FILE_PATH, entry, (err) => {
        if (err) console.error('Failed to log revenue:', err);
    });
}

// Function to update user balance in CSV
function updateCSVUserBalance(userId, amountChange) {
    try {
        const data = fs.readFileSync(CSV_FILE_PATH, 'utf8');
        const lines = data.split('\n');
        if (lines.length < 2) return;
        
        const header = lines[0];
        const updatedLines = lines.slice(1).map(line => {
            if (!line.trim()) return line;
            const parts = line.split(',');
            if (parts[0]?.trim() === String(userId).trim()) {
                // parts[4] is the balance column
                parts[4] = (parseFloat(parts[4] || 0) + parseFloat(amountChange)).toFixed(2);
            }
            return parts.join(',');
        });
        
        fs.writeFileSync(CSV_FILE_PATH, [header, ...updatedLines].join('\n'));
        console.log(`[CSV SYNC] Updated balance for user ${userId} by ${amountChange}`);
    } catch (err) {
        console.error('Failed to update CSV balance:', err);
    }
}

// API Endpoint to handle new user registration
// API for Password Update
app.post('/api/user/update-password', (req, res) => {
    const { userId, oldPassword, newPassword } = req.body;
    if (!userId || !oldPassword || !newPassword) return res.status(400).json({ error: 'Missing information' });

    fs.readFile(CSV_FILE_PATH, 'utf8', (err, data) => {
        if (err) return res.status(500).json({ error: 'Server data error' });
        
        // Handle potential \r\n from Windows and clean empty lines
        const lines = data.replace(/\r/g, '').split('\n').filter(l => l.trim());
        if (lines.length === 0) return res.status(500).json({ error: 'Database is empty' });
        
        const header = lines[0];
        let userFound = false;
        let passwordCorrect = false;

        const updatedLines = lines.slice(1).map(line => {
            const parts = line.split(',');
            if (String(parts[0]).trim() === String(userId).trim()) {
                userFound = true;
                if (String(parts[2]).trim() === String(oldPassword).trim()) {
                    passwordCorrect = true;
                    parts[2] = String(newPassword).trim();
                }
            }
            return parts.join(',');
        });

        if (!userFound) return res.status(404).json({ error: 'User not found' });
        if (!passwordCorrect) return res.status(401).json({ error: 'Incorrect old password' });

        try {
            fs.writeFileSync(CSV_FILE_PATH, header.trim() + '\n' + updatedLines.join('\n') + '\n');
            res.status(200).json({ success: true });
        } catch (writeErr) {
            console.error('CSV Write Error:', writeErr);
            res.status(500).json({ error: 'Failed to save updated password' });
        }
    });
});

app.post('/api/user/reset-password', (req, res) => {
    const { phoneNumber, newPassword } = req.body;
    if (!phoneNumber || !newPassword) return res.status(400).json({ error: 'Missing information' });

    fs.readFile(CSV_FILE_PATH, 'utf8', (err, data) => {
        if (err) return res.status(500).json({ error: 'Server data error' });
        
        const lines = data.replace(/\r/g, '').split('\n').filter(l => l.trim());
        const header = lines[0];
        let userFound = false;

        const updatedLines = lines.slice(1).map(line => {
            const parts = line.split(',');
            // Match by Phone Number (parts[1])
            if (String(parts[1]).trim() === String(phoneNumber).trim()) {
                userFound = true;
                parts[2] = String(newPassword).trim();
            }
            return parts.join(',');
        });

        if (!userFound) return res.status(404).json({ error: 'User not found' });

        try {
            fs.writeFileSync(CSV_FILE_PATH, header.trim() + '\n' + updatedLines.join('\n') + '\n');
            res.status(200).json({ success: true });
        } catch (writeErr) {
            console.error('Reset CSV Write Error:', writeErr);
            res.status(500).json({ error: 'Failed to reset password' });
        }
    });
});

app.post('/api/user/update-profile', (req, res) => {
    const { userId, name, gender } = req.body;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    fs.readFile(CSV_FILE_PATH, 'utf8', (err, data) => {
        if (err) return res.status(500).json({ error: 'Server data error' });
        const lines = data.split('\n');
        const header = lines[0];
        
        let updated = false;
        const updatedLines = lines.slice(1).map(line => {
            if (!line.trim()) return line;
            const parts = line.split(',');
            if (parts[0] === String(userId)) {
                // Ensure array has enough elements
                while (parts.length < 8) parts.push('');
                parts[6] = name || parts[6];
                parts[7] = gender || parts[7];
                updated = true;
            }
            return parts.join(',');
        });

        if (updated) {
            fs.writeFileSync(CSV_FILE_PATH, [header, ...updatedLines].join('\n'));
        }
        res.status(200).json({ success: true });
    });
});

app.post('/api/register', (req, res) => {
    const { id, phoneNumber, password, role, createdAt } = req.body;
    console.log(`[AUTH] Register Attempt: ${phoneNumber}`);
    
    if (!phoneNumber || !password) {
        return res.status(400).json({ error: 'Phone number and password are required' });
    }

    try {
        // 1. Check if user already exists in CSV
        const data = fs.readFileSync(CSV_FILE_PATH, 'utf8');
        const lines = data.trim().split('\n').slice(1);
        const userExists = lines.some(line => {
            const parts = line.split(',');
            return parts[1] === String(phoneNumber).trim();
        });

        if (userExists) {
            return res.status(409).json({ error: 'User with this phone number already exists' });
        }

        // 2. Create new user entry
        const initialBalance = 0;
        const userRole = (role || 'USER').trim();
        const safePhone = String(phoneNumber).trim();
        const safePass = String(password).trim();
        const newEntry = `${id || Date.now()},${safePhone},${safePass},${userRole},${initialBalance},${createdAt || new Date().toISOString()}\n`;

        // 3. Append to CSV
        fs.appendFile(CSV_FILE_PATH, newEntry, (err) => {
            if (err) {
                console.error('Failed to write to CSV:', err);
                return res.status(500).json({ error: 'Failed to save user data on server' });
            }
            console.log(`[SUCCESS] New user appended: ${safePhone}`);
            res.status(200).json({ success: true, message: 'User stored successfully' });
        });
    } catch (err) {
        console.error('Registration Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// API Endpoint for Login
app.post('/api/login', (req, res) => {
    const { phoneNumber, password } = req.body;
    console.log(`[AUTH] Login Attempt: ${phoneNumber}`);
    
    if (!phoneNumber || !password) {
        console.warn(`[AUTH] Login failed: Empty credentials`);
        return res.status(400).json({ error: 'Phone number and password are required' });
    }

    fs.readFile(CSV_FILE_PATH, 'utf8', (err, data) => {
        try {
            if (err) return res.status(500).json({ error: 'Database check failed' });
            
            const lines = data.trim().split('\n');
            if (lines.length <= 1) return res.status(401).json({ error: 'User not found' });

            const incomingPhone = String(phoneNumber).trim();
            const incomingPass = String(password).trim();

            const userLine = lines.slice(1).find(line => {
                const parts = line.split(',');
                // Ensure all CSV parts are trimmed for comparison
                return String(parts[1]).trim() === incomingPhone && String(parts[2]).trim() === incomingPass;
            });

            if (!userLine) {
                console.warn(`[AUTH] Login failed: No match for ${incomingPhone}`);
                return res.status(401).json({ error: 'Invalid phone number or password' });
            }

            const parts = userLine.split(',');
            const userData = {
                id: parts[0],
                phoneNumber: parts[1],
                role: parts[3],
                balance: parseFloat(parts[4] || 0),
                name: parts[6] || parts[1],
                gender: parts[7] || 'Not Set'
            };

            const token = `offline_token_${userData.id}`;
            res.status(200).json({ success: true, token, user: userData });
        } catch (fatal) {
            console.error('Login Error:', fatal);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });
});

// API Endpoint to get My Profile (Auth Required)
app.get('/api/auth/me', (req, res) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(401).json({ error: 'No token provided' });
    
    const tokenParts = authHeader.split('_');
    const userId = tokenParts.pop();

    fs.readFile(CSV_FILE_PATH, 'utf8', (err, data) => {
        if (err) return res.status(500).json({ error: 'Profile fetch failed' });
        
        const lines = data.trim().split('\n').slice(1);
        const userLine = lines.find(line => line.startsWith(userId + ','));

        if (!userLine) return res.status(404).json({ error: 'User not found' });

        const parts = userLine.split(',');
        res.status(200).json({
            id: parts[0],
            phoneNumber: parts[1],
            role: parts[3],
            balance: parseFloat(parts[4]),
            name: parts[1]
        });
    });
});

// API Endpoint to get Platform Revenue (including commissions)
app.get('/api/admin/revenue', (req, res) => {
    fs.readFile(REVENUE_FILE_PATH, 'utf8', (err, data) => {
        if (err) return res.status(500).json({ error: 'Failed to read revenue data' });
        
        const lines = data.trim().split('\n').slice(1);
        let totalCommission = 0;
        
        lines.forEach(line => {
            const parts = line.split(',');
            if (parts[1] === 'COMMISSION') {
                totalCommission += parseFloat(parts[2] || 0);
            }
        });
        
        res.status(200).json({ totalCommission });
    });
});

// Helper for future expansion: Route to log commission from winning
app.post('/api/admin/log-commission', (req, res) => {
    const { amount, description } = req.body;
    logRevenue('COMMISSION', amount, description || '10% Win Tax');
    res.status(200).json({ success: true });
});

// ================= BETTING LOGIC (New) =================
const BETS_FILE_PATH = path.join(__dirname, 'database', 'bets.csv');
const HISTORY_FILE_PATH = path.join(__dirname, 'database', 'history.csv');

// Initialize files if not exists
if (!fs.existsSync(BETS_FILE_PATH)) {
    fs.writeFileSync(BETS_FILE_PATH, 'id,userId,periodId,selection,amount,status,winAmount,timestamp\n');
}
if (!fs.existsSync(HISTORY_FILE_PATH)) {
    fs.writeFileSync(HISTORY_FILE_PATH, 'periodId,resultNumber,resultColor,size,timestamp\n');
}

// Endpoint to place a bet
app.post('/api/bets/place', (req, res) => {
    const { periodId, selection, amount } = req.body;
    const authHeader = req.headers['authorization'];
    
    // Extract userId from token (e.g. "Bearer offline_token_12345")
    const userId = authHeader ? authHeader.split('_').pop() : 'UNKNOWN';

    if (!periodId || !selection || !amount) {
        return res.status(400).json({ error: 'Missing bet information' });
    }

    const betId = 'B' + Date.now();
    const entry = `${betId},${userId},${periodId},${selection},${amount},PENDING,0,${new Date().toISOString()}\n`;

    fs.appendFile(BETS_FILE_PATH, entry, (err) => {
        if (err) return res.status(500).json({ error: 'Failed to save bet' });
        
        // Sync balance deduction to CSV
        updateCSVUserBalance(userId, -amount);
        
        res.status(200).json({ success: true, betId });
    });
});

// Endpoint to get user bets
app.get('/api/bets/my', (req, res) => {
    const authHeader = req.headers['authorization'];
    const userId = authHeader ? authHeader.split('_').pop() : 'UNKNOWN';

    fs.readFile(BETS_FILE_PATH, 'utf8', (err, data) => {
        if (err) return res.status(200).json([]);
        const lines = data.trim().split('\n').slice(1);
        const myBets = lines
            .map(line => {
                const parts = line.split(',');
                return {
                    id: parts[0], userId: parts[1], periodId: parts[2],
                    selection: parts[3], amount: parseFloat(parts[4]),
                    status: parts[5], winAmount: parseFloat(parts[6]),
                    timestamp: parts[7]
                };
            })
            .filter(b => b.userId === userId)
            .reverse();
        res.status(200).json(myBets);
    });
});

// Endpoint to get game history
app.get('/api/history', (req, res) => {
    const mode = req.query.mode || '1Min';
    fs.readFile(HISTORY_FILE_PATH, 'utf8', (err, data) => {
        if (err) return res.status(200).json([]);
        const lines = data.trim().split('\n').slice(1);
        const history = lines.map(line => {
            const parts = line.split(',');
            return {
                periodId: parts[0], resultNumber: parts[1],
                resultColor: parts[2], size: parts[3],
                timestamp: parts[4]
            };
        }).reverse();
        res.status(200).json(history);
    });
});

// Admin endpoint to manually set result (used by frontend admin panel)
app.post('/api/admin/set-result', (req, res) => {
    const { number } = req.body;
    // For now, we just acknowledge it. In a real system, we'd store this for the next period.
    console.log(`[ADMIN] Next result set to: ${number}`);
    res.status(200).json({ success: true });
});

// Endpoint to sync winnings and commission to database
app.post('/api/user/sync-win', (req, res) => {
    const { userId, rawWinnings, commission, netWinnings, periodId } = req.body;
    
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    // 1. Update User Balance in CSV (Add 90% winnings)
    updateCSVUserBalance(userId, netWinnings);

    // 2. Log 10% Commission in Revenue CSV
    logRevenue('COMMISSION', commission, `10% Tax from Period ${periodId}`);

    res.status(200).json({ success: true });
});

// ================= PAYMENTS LOGIC (New) =================

// Endpoint to request recharge
app.post('/api/recharge', (req, res) => {
    const { userId, userName, amount, upiId } = req.body;
    console.log(`[RECHARGE REQUEST] User: ${userId} (${userName}), Amount: ₹${amount}`);
    
    if (!userId || !amount) {
        console.warn(`[RECHARGE FAILED] Missing info for request from User: ${userId}`);
        return res.status(400).json({ error: 'Missing information' });
    }

    const id = 'REC' + Date.now();
    const entry = `${id},${userId},${userName},${amount},${upiId || 'QR'},PENDING,${new Date().toISOString()}\n`;
    
    fs.appendFile(RECHARGES_FILE_PATH, entry, (err) => {
        if (err) {
            console.error(`[RECHARGE ERROR] Failed to write to CSV: ${err.message}`);
            return res.status(500).json({ error: 'Failed to save recharge' });
        }
        console.log(`[RECHARGE SUCCESS] Saved request ${id} to database.`);
        
        // Notify all admins in real-time via Socket.io
        io.emit('admin_notification', { 
            type: 'recharge', 
            userId, 
            userName, 
            amount, 
            message: `New Recharge Request: ₹${amount}` 
        });

        res.status(200).json({ success: true, id });
    });
});


// Endpoint to get user recharge history
app.get('/api/recharge/my', (req, res) => {
    const authHeader = req.headers['authorization'];
    const userId = authHeader ? authHeader.split('_').pop() : 'UNKNOWN';

    fs.readFile(RECHARGES_FILE_PATH, 'utf8', (err, data) => {
        if (err) return res.status(200).json([]);
        // Remove \r and split by \n
        const lines = data.replace(/\r/g, '').trim().split('\n').slice(1);
        const myRecharges = lines
            .map(line => {
                const parts = line.split(',');
                return {
                    id: parts[0]?.trim(), 
                    userId: parts[1]?.trim(), 
                    userName: parts[2]?.trim(),
                    amount: parseFloat(parts[3] || 0), 
                    upiId: parts[4]?.trim(),
                    status: parts[5]?.trim(), 
                    timestamp: parts[6]?.trim()
                };
            })
            .filter(r => String(r.userId) === String(userId))
            .reverse();
        res.status(200).json(myRecharges);
    });
});

// Endpoint to request withdrawal
app.post('/api/withdraw', (req, res) => {
    const { userId, userName, amount, upiId } = req.body;
    if (!userId || !amount) return res.status(400).json({ error: 'Missing information' });

    try {
        // Read latest user data to check balance
        const allUsers = fs.readFileSync(CSV_FILE_PATH, 'utf8').split('\n');
        const userLine = allUsers.find(l => l.startsWith(userId + ','));
        if (!userLine) return res.status(404).json({ error: 'User not found' });
        
        const currentBalance = parseFloat(userLine.split(',')[4] || 0);
        if (currentBalance < parseFloat(amount)) {
            return res.status(400).json({ error: 'Insufficient balance' });
        }

        const id = 'WD' + Date.now();
        const entry = `${id},${userId},${userName},${amount},${upiId},PENDING,${new Date().toISOString()}\n`;
        
        fs.appendFile(WITHDRAWALS_FILE_PATH, entry, (err) => {
            if (err) return res.status(500).json({ error: 'Failed to save withdrawal' });
            
            // Deduct balance immediately
            updateCSVUserBalance(userId, -amount);
            res.status(200).json({ success: true, id });
        });
    } catch (err) {
        console.error('Withdraw Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Admin reports endpoint
app.get('/api/admin/reports', (req, res) => {
    const type = req.query.type; // 'recharge' or 'withdraw'
    const filePath = type === 'recharge' ? RECHARGES_FILE_PATH : WITHDRAWALS_FILE_PATH;

    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) return res.status(200).json([]);
        // Handle line endings and empty lines
        const lines = data.replace(/\r/g, '').trim().split('\n').slice(1);
        const reports = lines.map(line => {
            const parts = line.split(',');
            return {
                id: parts[0]?.trim(), 
                userId: parts[1]?.trim(), 
                userName: parts[2]?.trim(),
                amount: parseFloat(parts[3] || 0), 
                upiId: parts[4]?.trim(),
                status: parts[5]?.trim(), 
                timestamp: parts[6]?.trim()
            };
        });
        res.status(200).json(reports);
    });
});

// Get all users for admin list
app.get('/api/admin/users', (req, res) => {
    fs.readFile(CSV_FILE_PATH, 'utf8', (err, data) => {
        if (err) return res.status(500).json({ error: 'Failed to read users' });
        const lines = data.trim().split('\n').slice(1);
        const users = lines.map(line => {
            const parts = line.split(',');
            return {
                id: parts[0],
                username: parts[1],
                role: parts[3],
                balance: parseFloat(parts[4] || 0),
                name: parts[6] || parts[1],
                gender: parts[7] || 'Not Set',
                status: 'Offline'
            };
        });
        res.status(200).json(users);
    });
});

// Admin endpoint to get total revenue/commission
app.get('/api/admin/revenue', (req, res) => {
    fs.readFile(REVENUE_FILE_PATH, 'utf8', (err, data) => {
        if (err) return res.status(200).json({ totalCommission: 0 });
        
        const lines = data.trim().split('\n').slice(1);
        let totalCommission = 0;
        
        lines.forEach(line => {
            if (!line.trim()) return;
            // Structure: Timestamp,Type,Amount,Description
            // Notice: The amount is the 3rd item (index 2)
            // But wait, the description might contain commas!
            // Actually, description is wrapped in quotes: "10% Tax from Period..."
            // A simple split by ',' will split the description but we only need index 2.
            const parts = line.split(',');
            if (parts[1] === 'COMMISSION') {
                totalCommission += parseFloat(parts[2]) || 0;
            }
        });
        
        res.status(200).json({ totalCommission });
    });
});

// Manually adjust user balance
app.post('/api/admin/adjust-balance', (req, res) => {
    const { userId, amountChange } = req.body;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    updateCSVUserBalance(userId, amountChange);
    res.status(200).json({ success: true });
});

// Admin update transaction (Approve/Reject)
app.post('/api/admin/update-transaction', (req, res) => {
    const { id, type, status, userId, amount } = req.body;
    const filePath = type === 'recharge' ? RECHARGES_FILE_PATH : WITHDRAWALS_FILE_PATH;

    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) return res.status(500).json({ error: 'File read error' });
        const lines = data.replace(/\r/g, '').split('\n');
        const header = lines[0];
        const updatedLines = lines.slice(1).map(line => {
            if (!line.trim()) return line;
            const parts = line.split(',');
            if (parts[0]?.trim() === id) {
                parts[5] = status; // Update status column
            }
            return parts.join(',');
        });

        fs.writeFileSync(filePath, [header, ...updatedLines].join('\n'));

        // If recharge is approved, add balance
        if (type === 'recharge' && status === 'SUCCESS') {
            updateCSVUserBalance(userId, amount);
        }
        // If withdrawal is rejected, refund balance
        if (type === 'withdraw' && status === 'FAILED') {
            updateCSVUserBalance(userId, amount);
        }

        // Notify all admins and the specific user about the transaction update
        io.emit('admin_notification', { type, status, id });
        io.emit('transaction_update', { userId, type, status, id });

        res.status(200).json({ success: true });
    });
});

// Admin: Delete recharge record(s)
// DELETE /api/admin/delete-recharge?id=REC123          -> deletes single record by ID
// DELETE /api/admin/delete-recharge?userId=101         -> deletes ALL records for a user
app.delete('/api/admin/delete-recharge', (req, res) => {
    const { id, userId } = req.query;

    if (!id && !userId) {
        return res.status(400).json({ error: 'Provide id or userId to delete' });
    }

    fs.readFile(RECHARGES_FILE_PATH, 'utf8', (err, data) => {
        if (err) return res.status(500).json({ error: 'Failed to read recharge file' });

        const lines = data.replace(/\r/g, '').split('\n');
        const header = lines[0];
        const dataLines = lines.slice(1).filter(l => l.trim());

        let deletedCount = 0;
        const updatedLines = dataLines.filter(line => {
            const parts = line.split(',');
            const rowId = parts[0]?.trim();
            const rowUserId = parts[1]?.trim();

            if (id && rowId === id) { deletedCount++; return false; }
            if (userId && rowUserId === userId) { deletedCount++; return false; }
            return true;
        });

        if (deletedCount === 0) {
            return res.status(404).json({ error: 'No matching records found' });
        }

        try {
            fs.writeFileSync(RECHARGES_FILE_PATH, header + '\n' + updatedLines.join('\n') + (updatedLines.length ? '\n' : ''));
            console.log(`[ADMIN DELETE] Removed ${deletedCount} recharge record(s). id=${id || 'N/A'} userId=${userId || 'N/A'}`);
            res.status(200).json({ success: true, deletedCount });
        } catch (writeErr) {
            res.status(500).json({ error: 'Failed to write updated recharge file' });
        }
    });
});

// Admin API to get/set UPI ID
app.get('/api/admin/upi', (req, res) => {
    try {
        if (fs.existsSync(SETTINGS_FILE_PATH)) {
            const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE_PATH, 'utf8'));
            return res.json({ upiId: settings.upiId || '8815054681@ybl' });
        }
        res.json({ upiId: '8815054681@ybl' });
    } catch(e) { res.json({ upiId: '8815054681@ybl' }); }
});

app.post('/api/admin/upi', (req, res) => {
    const { upiId } = req.body;
    try {
        let settings = {};
        if (fs.existsSync(SETTINGS_FILE_PATH)) {
            settings = JSON.parse(fs.readFileSync(SETTINGS_FILE_PATH, 'utf8'));
        }
        settings.upiId = upiId;
        fs.writeFileSync(SETTINGS_FILE_PATH, JSON.stringify(settings, null, 2));
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: 'Failed to save settings' }); }
});

// API Endpoint to get User Withdrawal History
app.get('/api/withdraw/my', (req, res) => {
    const authHeader = req.headers['authorization'];
    const userId = authHeader ? authHeader.split('_').pop() : 'UNKNOWN';

    fs.readFile(WITHDRAWALS_FILE_PATH, 'utf8', (err, data) => {
        if (err) return res.status(200).json([]);
        const lines = data.trim().split('\n').slice(1);
        const myWithdrawals = lines
            .map(line => {
                const parts = line.split(',');
                return {
                    id: parts[0], userId: parts[1], userName: parts[2],
                    amount: parseFloat(parts[3]), upiId: parts[4],
                    status: parts[5], timestamp: parts[6]
                };
            })
            .filter(r => r.userId === userId)
            .reverse();
        res.status(200).json(myWithdrawals);
    });
});

// Endpoint to get game history
app.get('/api/history', (req, res) => {
    const mode = req.query.mode || '1Min';
    fs.readFile(HISTORY_FILE_PATH, 'utf8', (err, data) => {
        if (err) return res.status(200).json([]);
        const lines = data.trim().split('\n').slice(1);
        const history = lines.map(line => {
            const parts = line.split(',');
            return {
                periodId: parts[0],
                resultNumber: parseInt(parts[1]),
                resultColor: parts[2],
                size: parts[3],
                timestamp: parts[4]
            };
        }).reverse().slice(0, 50);
        res.status(200).json(history);
    });
});

// ================= GAME ENGINE (SOCKET.IO) =================
const MODE_DURATIONS = { '30s': 30, '1Min': 60, '3Min': 180, '5Min': 300 };
const gameStates = {};

// Function to process all pending bets for a finished period
function processBetsForPeriod(mode, periodId, winningNumber, size, colors) {
    console.log(`[PROCESS] Processing bets for ${mode} Period ${periodId} | Won: ${winningNumber}`);
    
    try {
        if (!fs.existsSync(BETS_FILE_PATH)) return;
        const data = fs.readFileSync(BETS_FILE_PATH, 'utf8');
        const lines = data.split('\n');
        const header = lines[0];
        let updated = false;

        const updatedLines = lines.slice(1).map(line => {
            if (!line.trim()) return line;
            const parts = line.split(',');
            // parts: id,userId,periodId,selection,amount,status,winAmount,timestamp
            
            if (parts[2] === periodId && parts[5] === 'PENDING') {
                updated = true;
                const selection = parts[3];
                const amount = parseFloat(parts[4]);
                const userId = parts[1];
                
                let won = false;
                let multiplier = 0;

                // Check Win Conditions
                if (selection === 'Green' && [1, 3, 7, 9, 5].includes(winningNumber)) {
                    won = true;
                    multiplier = (winningNumber === 5) ? 1.5 : 2;
                } else if (selection === 'Red' && [0, 2, 4, 6, 8].includes(winningNumber)) {
                    won = true;
                    multiplier = (winningNumber === 0) ? 1.5 : 2;
                } else if (selection === 'Violet' && [0, 5].includes(winningNumber)) {
                    won = true;
                    multiplier = 4.5;
                } else if (selection === `Number ${winningNumber}`) {
                    won = true;
                    multiplier = 9;
                } else if (selection === size) {
                    won = true;
                    multiplier = 2;
                }

                if (won) {
                    const rawWinnings = amount * multiplier;
                    const commission = rawWinnings * 0.10;
                    const netWinnings = rawWinnings - commission;
                    
                    parts[5] = 'WIN';
                    parts[6] = netWinnings.toFixed(2);
                    
                    // Add balance to user
                    updateCSVUserBalance(userId, netWinnings);
                    // Log commission
                    logRevenue('COMMISSION', commission, `10% Tax from Period ${periodId} User ${userId}`);
                    
                    console.log(`[WIN] User ${userId} won ${netWinnings} on ${selection}`);
                } else {
                    parts[5] = 'LOSS';
                    parts[6] = '0';
                    console.log(`[LOSS] User ${userId} lost ${amount} on ${selection}`);
                    
                    // Notify Admin of loss (Task 3)
                    const msg = `[${new Date().toLocaleString()}] ALERT: User ${userId} lost ₹${amount} in Period ${periodId}\n`;
                    fs.appendFileSync(path.join(__dirname, 'database', 'admin_alerts.txt'), msg);
                }
            }
            return parts.join(',');
        });

        if (updated) {
            fs.writeFileSync(BETS_FILE_PATH, [header, ...updatedLines].join('\n'));
        }
    } catch (err) {
        console.error('Failed to process bets:', err);
    }
}

function initGameMode(mode) {
    gameStates[mode] = {
        timeLeft: MODE_DURATIONS[mode],
        periodId: new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12) + '00',
        currentBets: []
    };

    setInterval(() => {
        const state = gameStates[mode];
        state.timeLeft--;

        if (state.timeLeft <= 0) {
            // End Period, Generate Result
            const winningNumber = Math.floor(Math.random() * 10);
            const size = winningNumber >= 5 ? 'Big' : 'Small';
            const colors = winningNumber === 0 ? ['Red', 'Violet'] : winningNumber === 5 ? ['Green', 'Violet'] : (winningNumber % 2 === 0 ? ['Red'] : ['Green']);
            
            const resultRecord = `${state.periodId},${winningNumber},${colors.join('/')},${size},${new Date().toISOString()}\n`;
            fs.appendFileSync(HISTORY_FILE_PATH, resultRecord);

            // PROCESS BETS (NEW)
            processBetsForPeriod(mode, state.periodId, winningNumber, size, colors);

            io.emit(`gameResult_${mode}`, {
                periodId: state.periodId,
                resultNumber: winningNumber,
                size: size,
                colors: colors
            });

            // Start New Period
            state.timeLeft = MODE_DURATIONS[mode];
            state.periodId = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12) + Math.floor(Math.random() * 90 + 10);
        }

        io.emit(`timerUpdate_${mode}`, {
            timeLeft: state.timeLeft,
            periodId: state.periodId
        });
    }, 1000);
}

// Initialize modes
Object.keys(MODE_DURATIONS).forEach(m => initGameMode(m));

let onlineSockets = new Set();
let loggedInUsers = new Map();

io.on('connection', (socket) => {
    onlineSockets.add(socket.id);
    io.emit('onlineUsersCount', { total: onlineSockets.size, loggedIn: new Set(loggedInUsers.values()).size });
    
    socket.on('user_login', (userId) => {
        if(userId) {
            loggedInUsers.set(socket.id, userId);
            io.emit('onlineUsersCount', { total: onlineSockets.size, loggedIn: new Set(loggedInUsers.values()).size });
        }
    });

    socket.on('disconnect', () => {
        onlineSockets.delete(socket.id);
        loggedInUsers.delete(socket.id);
        io.emit('onlineUsersCount', { total: onlineSockets.size, loggedIn: new Set(loggedInUsers.values()).size });
    });
});

// Start the server
// Global Error Handler
app.use((err, req, res, next) => {
    console.error('[SERVER ERROR]', err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
});

http.listen(PORT, '0.0.0.0', () => {
    console.log(`==========================================`);
    console.log(`🚀 Wingo Game Server Running on Port ${PORT}`);
    console.log(`📡 WebSocket Support: Enabled`);
    console.log(`📂 Serving Frontend from: /client`);
    console.log(`📊 User DB: ${CSV_FILE_PATH}`);
    console.log(`🔗 Access at: http://localhost:${PORT}`);
    console.log(`==========================================`);
});
