const express = require('express');
const cors = require('cors');
const midtransClient = require('midtrans-client');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// --- 1. KONEKSI DATABASE KHUSUS VERCEL (SERVERLESS) ---
const MONGODB_URI = 'mongodb+srv://fareldef01_db_user:Farel12345@cluster0.fshemrp.mongodb.net/votingdb?appName=Cluster0'; 

// Cetakan Data
const finalisSchema = new mongoose.Schema({
    id: String,
    nama: String,
    vote: Number,
    foto: String
});
const Finalis = mongoose.models.Finalis || mongoose.model('Finalis', finalisSchema);

// Fungsi jaminan koneksi agar tidak Time Out di Vercel
const connectDB = async () => {
    if (mongoose.connection.readyState >= 1) return; // Jika sudah konek, lewati
    
    console.log('Menghubungkan ke MongoDB...');
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    
    // Isi data awal jika masih kosong
    const jumlahData = await Finalis.countDocuments();
    if (jumlahData === 0) {
        await Finalis.insertMany([
            { id: 'bujang_1', nama: 'Andi (Bujang)', vote: 10, foto: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=300' },
            { id: 'gadis_1', nama: 'Siti (Gadis)', vote: 15, foto: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=300' },
            { id: 'bujang_2', nama: 'Rian (Bujang)', vote: 5, foto: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=300' }
        ]);
    }
};

// --- 2. KONFIGURASI MIDTRANS ---
const snap = new midtransClient.Snap({
    isProduction: false,
    serverKey: 'Mid-server-x4V0sK8bbsKoYL6xpHRBFfY9'
});
let hargaPerVote = 5000;

// --- RUTE UTAMA ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- 3. API: Mengambil Data Finalis ---
app.get('/api/finalis', async (req, res) => {
    try {
        await connectDB(); // WAJIB BANGUNKAN DATABASE DULU
        const dataFinalis = await Finalis.find({});
        res.json(dataFinalis);
    } catch (error) {
        res.status(500).json({ error: 'Gagal mengambil data', pesanAsli: error.message });
    }
});

// --- 4. API: Membuat Transaksi Pembayaran ---
app.post('/api/bayar-vote', async (req, res) => {
    const { id_finalis, jumlah_vote, nama_voter } = req.body;
    const totalHarga = jumlah_vote * hargaPerVote;
    const orderId = `VOTE-${id_finalis}-${Date.now()}`;

    let parameter = {
        transaction_details: { order_id: orderId, gross_amount: totalHarga },
        credit_card: { secure: true },
        customer_details: { first_name: nama_voter, email: 'voter@example.com' },
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

// --- 5. API: Webhook (Menerima Notifikasi) ---
app.post('/api/webhook', async (req, res) => {
    const notif = req.body;
    try {
        await connectDB(); // WAJIB BANGUNKAN DATABASE DULU
        const statusResponse = await snap.transaction.notification(notif);
        const transactionStatus = statusResponse.transaction_status;
        const fraudStatus = statusResponse.fraud_status;
        const idFinalis = statusResponse.custom_field1;
        const jumlahVote = parseInt(statusResponse.custom_field2);

        if (transactionStatus == 'capture' || transactionStatus == 'settlement') {
            if (fraudStatus == 'accept' || !fraudStatus) {
                await Finalis.findOneAndUpdate(
                    { id: idFinalis },
                    { $inc: { vote: jumlahVote } }
                );
            }
        }
        res.status(200).send('OK');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server berjalan di port ${PORT}`));

module.exports = app;