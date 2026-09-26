// File: server.js
const express = require('express');
const cors = require('cors');
const midtransClient = require('midtrans-client');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); // Agar bisa membuka index.html

// --- 1. KONFIGURASI MIDTRANS ---
const snap = new midtransClient.Snap({
    isProduction: false,
    serverKey: 'Mid-server-x4V0sK8bbsKoYL6xpHRBFfY9' 
});

// --- 2. DATABASE SEMENTARA (Mock Database) ---
// CARA MENAMBAH FINALIS: Cukup tambah baris baru di bawah dengan id yang berbeda
let finalis = [
    { id: 'bujang_1', nama: 'Andi (Bujang)', vote: 10, foto: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=300' },
    { id: 'gadis_1', nama: 'Siti (Gadis)', vote: 15, foto: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=300' },
    { id: 'bujang_2', nama: 'Rian (Bujang)', vote: 5, foto: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=300' } 
];

let hargaPerVote = 5000; // Rp 5.000 per 1 Vote

// --- 3. API: Mengambil Data Finalis ---
app.get('/api/finalis', (req, res) => {
    res.json(finalis);
});

// --- 4. API: Membuat Transaksi Pembayaran (Request Snap Token) ---
app.post('/api/bayar-vote', async (req, res) => {
    const { id_finalis, jumlah_vote, nama_voter } = req.body;
    
    const totalHarga = jumlah_vote * hargaPerVote;
    const orderId = `VOTE-${id_finalis}-${Date.now()}`;

    let parameter = {
        transaction_details: {
            order_id: orderId,
            gross_amount: totalHarga
        },
        credit_card: { secure: true },
        customer_details: {
            first_name: nama_voter,
            email: 'voter@example.com'
        },
        custom_field1: id_finalis,
        custom_field2: jumlah_vote.toString()
    };

    try {
        const transaction = await snap.createTransaction(parameter);
        res.json({ token: transaction.token });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Gagal membuat pembayaran' });
    }
});

// --- 5. API: Webhook (Menerima Notifikasi dari Midtrans) ---
app.post('/api/webhook', async (req, res) => {
    const notif = req.body;

    try {
        const statusResponse = await snap.transaction.notification(notif);
        const orderId = statusResponse.order_id;
        const transactionStatus = statusResponse.transaction_status;
        const fraudStatus = statusResponse.fraud_status;
        
        const idFinalis = statusResponse.custom_field1;
        const jumlahVote = parseInt(statusResponse.custom_field2);

        if (transactionStatus == 'capture' || transactionStatus == 'settlement') {
            if (fraudStatus == 'challenge') {
                console.log('Pembayaran mencurigakan');
            } else if (fraudStatus == 'accept' || !fraudStatus) {
                console.log(`Pembayaran Sukses! Menambahkan ${jumlahVote} vote ke ${idFinalis}`);
                
                let targetFinalis = finalis.find(f => f.id === idFinalis);
                if(targetFinalis) {
                    targetFinalis.vote += jumlahVote;
                }
            }
        }
        res.status(200).send('OK');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error');
    }
});

// --- JALANKAN SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server berjalan di port ${PORT}`);
});