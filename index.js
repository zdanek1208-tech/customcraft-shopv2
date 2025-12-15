// ========================================
// CUSTOMCRAFT BACKEND - RENDER.COM
// ========================================

const express = require('express');
const cors = require('cors');
const { Rcon } = require('rcon-client');
const fs = require('fs');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// ========================================
// KONFIGURACJA - Używa zmiennych środowiskowych
// ========================================

const CONFIG = {
    // PayPal
    paypal: {
        clientId: process.env.PAYPAL_CLIENT_ID || 'TWOJ_PAYPAL_CLIENT_ID',
        clientSecret: process.env.PAYPAL_SECRET || 'TWOJ_PAYPAL_CLIENT_SECRET',
        mode: process.env.NODE_ENV === 'production' ? 'live' : 'sandbox'
    },
    
    // Minecraft Server RCON
    minecraft: {
        host: process.env.MINECRAFT_HOST || 'CustomCraft.serv.cx',
        port: parseInt(process.env.RCON_PORT) || 25575,
        password: process.env.RCON_PASSWORD || 'TWOJE_HASLO_RCON'
    },
    
    // Server Port
    port: process.env.PORT || 3000
};

// ========================================
// SYSTEM PLIKÓW
// ========================================

const TRANSACTIONS_FILE = './transactions.json';
const VOUCHERS_FILE = './vouchers.json';

function loadTransactions() {
    try {
        if (fs.existsSync(TRANSACTIONS_FILE)) {
            return JSON.parse(fs.readFileSync(TRANSACTIONS_FILE, 'utf8'));
        }
    } catch (error) {
        console.error('Błąd odczytu transakcji:', error);
    }
    return [];
}

function saveTransaction(transaction) {
    const transactions = loadTransactions();
    transactions.push({
        ...transaction,
        timestamp: new Date().toISOString()
    });
    fs.writeFileSync(TRANSACTIONS_FILE, JSON.stringify(transactions, null, 2));
}

function loadVouchers() {
    try {
        if (fs.existsSync(VOUCHERS_FILE)) {
            return JSON.parse(fs.readFileSync(VOUCHERS_FILE, 'utf8'));
        }
    } catch (error) {
        console.error('Błąd odczytu voucherów:', error);
    }
    return [];
}

function saveVoucher(voucher) {
    const vouchers = loadVouchers();
    vouchers.push(voucher);
    fs.writeFileSync(VOUCHERS_FILE, JSON.stringify(vouchers, null, 2));
}

function generateVoucherCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = 'VOUCHER-';
    for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function createVoucher(itemType, quantity = 1) {
    const code = generateVoucherCode();
    const voucher = {
        code: code,
        item_type: itemType,
        quantity: quantity,
        created_at: new Date().toISOString(),
        redeemed: false,
        redeemed_by: null,
        redeemed_at: null
    };
    saveVoucher(voucher);
    return voucher;
}

// ========================================
// MINECRAFT RCON
// ========================================

async function executeMinecraftCommand(command) {
    let rcon;
    try {
        rcon = await Rcon.connect({
            host: CONFIG.minecraft.host,
            port: CONFIG.minecraft.port,
            password: CONFIG.minecraft.password
        });
        
        const response = await rcon.send(command);
        console.log(`✅ Komenda wykonana: ${command}`);
        console.log(`📝 Odpowiedź: ${response}`);
        
        return response;
    } catch (error) {
        console.error(`❌ Błąd RCON: ${error.message}`);
        throw error;
    } finally {
        if (rcon) {
            await rcon.end();
        }
    }
}

async function grantRank(nick, rankType) {
    console.log(`\n⭐ Nadawanie rangi ${rankType} dla ${nick}...`);
    
    try {
        let command;
        
        if (rankType === 'VIP') {
            // LuckPerms - ranga VIP na 30 dni
            command = `lp user ${nick} parent settemp vip 30d`;
        } else if (rankType === 'VIP+') {
            // LuckPerms - ranga VIP+ na 30 dni
            command = `lp user ${nick} parent settemp vip+ 30d`;
        }
        
        await executeMinecraftCommand(command);
        console.log(`✅ Ranga ${rankType} nadana graczowi ${nick}!\n`);
        
    } catch (error) {
        console.error(`❌ Błąd nadawania rangi: ${error.message}\n`);
        throw error;
    }
}

async function giveKeys(nick, keyType, quantity) {
    console.log(`\n🔑 Nadawanie ${quantity}x ${keyType} dla ${nick}...`);
    
    try {
        let crateName;
        
        if (keyType === 'Klucz Rzadki') crateName = 'rare';
        else if (keyType === 'Klucz Epicki') crateName = 'epic';
        else if (keyType === 'Klucz Legendarny') crateName = 'legendary';
        else if (keyType === 'Klucz Mityczny') crateName = 'mythic';
        
        // CrazyCrates - nadanie fizycznego klucza
        const command = `crate give physical ${crateName} ${quantity} ${nick}`;
        
        await executeMinecraftCommand(command);
        console.log(`✅ Klucze ${keyType} nadane graczowi ${nick}!\n`);
        
    } catch (error) {
        console.error(`❌ Błąd nadawania kluczy: ${error.message}\n`);
        throw error;
    }
}

// ========================================
// ENDPOINT: Strona główna
// ========================================

app.get('/', (req, res) => {
    res.json({
        status: 'online',
        message: 'CustomCraft Backend działa!',
        version: '1.0.0',
        endpoints: {
            test_rcon: '/api/test-rcon',
            paypal_webhook: '/api/paypal-webhook',
            redeem_voucher: '/api/redeem-voucher',
            create_voucher: '/api/create-voucher',
            transactions: '/api/transactions',
            vouchers: '/api/vouchers'
        }
    });
});

// ========================================
// ENDPOINT: Webhook PayPal
// ========================================

app.post('/api/paypal-webhook', async (req, res) => {
    try {
        const {
            transaction_id,
            minecraft_nick,
            item_type,
            quantity,
            amount,
            payer_email,
            details
        } = req.body;
        
        console.log('\n🔔 Nowa płatność PayPal!');
        console.log('━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`💳 Transaction ID: ${transaction_id}`);
        console.log(`👤 Nick Minecraft: ${minecraft_nick}`);
        console.log(`📦 Produkt: ${item_type} ${quantity > 1 ? 'x' + quantity : ''}`);
        console.log(`💰 Kwota: ${amount} PLN`);
        console.log(`📧 Email: ${payer_email}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━\n');
        
        // Zapisz transakcję
        saveTransaction({
            transaction_id,
            minecraft_nick,
            item_type,
            quantity,
            amount,
            payer_email,
            status: 'processing'
        });
        
        // Nadaj rangę lub klucze
        if (item_type === 'VIP' || item_type === 'VIP+') {
            await grantRank(minecraft_nick, item_type);
        } else if (item_type.includes('Klucz')) {
            await giveKeys(minecraft_nick, item_type, quantity);
        }
        
        // Zaktualizuj status
        const transactions = loadTransactions();
        const lastTransaction = transactions[transactions.length - 1];
        lastTransaction.status = 'completed';
        fs.writeFileSync(TRANSACTIONS_FILE, JSON.stringify(transactions, null, 2));
        
        console.log('✅ Płatność przetworzona pomyślnie!\n');
        
        res.json({ 
            success: true, 
            message: 'Płatność przetworzona',
            minecraft_nick 
        });
        
    } catch (error) {
        console.error('❌ Błąd przetwarzania płatności:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ========================================
// ENDPOINT: Aktywacja vouchera
// ========================================

app.post('/api/redeem-voucher', async (req, res) => {
    try {
        const { minecraft_nick, voucher_code } = req.body;
        
        console.log('\n🎫 Próba aktywacji vouchera');
        console.log('━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`👤 Nick: ${minecraft_nick}`);
        console.log(`🔖 Kod: ${voucher_code}`);
        
        // Załaduj vouchery
        const vouchers = loadVouchers();
        const voucherIndex = vouchers.findIndex(v => v.code === voucher_code);
        
        if (voucherIndex === -1) {
            console.log('❌ Voucher nie istnieje\n');
            return res.json({ 
                success: false, 
                message: 'Nieprawidłowy kod vouchera' 
            });
        }
        
        const voucher = vouchers[voucherIndex];
        
        if (voucher.redeemed) {
            console.log(`❌ Voucher już wykorzystany przez: ${voucher.redeemed_by}\n`);
            return res.json({ 
                success: false, 
                message: 'Ten voucher został już wykorzystany' 
            });
        }
        
        // Nadaj nagrody
        console.log(`✅ Voucher prawidłowy! Nadaję: ${voucher.item_type}\n`);
        
        if (voucher.item_type === 'VIP' || voucher.item_type === 'VIP+') {
            await grantRank(minecraft_nick, voucher.item_type);
        } else if (voucher.item_type.includes('Klucz')) {
            await giveKeys(minecraft_nick, voucher.item_type, voucher.quantity);
        }
        
        // Oznacz voucher jako wykorzystany
        vouchers[voucherIndex].redeemed = true;
        vouchers[voucherIndex].redeemed_by = minecraft_nick;
        vouchers[voucherIndex].redeemed_at = new Date().toISOString();
        fs.writeFileSync(VOUCHERS_FILE, JSON.stringify(vouchers, null, 2));
        
        console.log('✅ Voucher aktywowany pomyślnie!\n');
        
        res.json({ 
            success: true, 
            message: 'Voucher aktywowany',
            minecraft_nick: minecraft_nick,
            reward: `${voucher.item_type}${voucher.quantity > 1 ? ' x' + voucher.quantity : ''}`
        });
        
    } catch (error) {
        console.error('❌ Błąd aktywacji vouchera:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ========================================
// ENDPOINT: Generowanie vouchera (ADMIN)
// ========================================

app.post('/api/create-voucher', (req, res) => {
    try {
        const { item_type, quantity, admin_key } = req.body;
        
        // Klucz admina
        if (admin_key !== 'SpinjistuMaster') {
            return res.status(401).json({ 
                success: false, 
                message: 'Brak autoryzacji' 
            });
        }
        
        const voucher = createVoucher(item_type, quantity || 1);
        
        console.log('\n🎫 Utworzono nowy voucher');
        console.log('━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`🔖 Kod: ${voucher.code}`);
        console.log(`📦 Nagroda: ${voucher.item_type} x${voucher.quantity}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━\n');
        
        res.json({ 
            success: true, 
            voucher: voucher 
        });
        
    } catch (error) {
        console.error('❌ Błąd tworzenia vouchera:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ========================================
// ENDPOINT: Lista transakcji (admin)
// ========================================

app.get('/api/transactions', (req, res) => {
    const transactions = loadTransactions();
    res.json(transactions);
});

// ========================================
// ENDPOINT: Lista voucherów (admin)
// ========================================

app.get('/api/vouchers', (req, res) => {
    const vouchers = loadVouchers();
    res.json(vouchers);
});

// ========================================
// ENDPOINT: Test RCON
// ========================================

app.get('/api/test-rcon', async (req, res) => {
    try {
        console.log('\n🧪 Test połączenia RCON...');
        const response = await executeMinecraftCommand('list');
        
        res.json({
            success: true,
            message: 'Połączenie RCON działa!',
            response: response
        });
    } catch (error) {
        console.error('❌ Test RCON nieudany:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ========================================
// URUCHOMIENIE SERWERA
// ========================================

app.listen(CONFIG.port, () => {
    console.log('\n🚀 Backend CustomCraft uruchomiony!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📡 Port: ${CONFIG.port}`);
    console.log(`🎮 Minecraft: ${CONFIG.minecraft.host}:${CONFIG.minecraft.port}`);
    console.log(`💳 PayPal: ${CONFIG.paypal.mode} mode`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n✅ Gotowy do przyjmowania płatności!\n');
});
