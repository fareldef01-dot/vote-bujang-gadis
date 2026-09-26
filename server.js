const express = require('express');
const cors = require('cors');
const midtransClient = require('midtrans-client');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// --- 1. KONEKSI DATABASE ---
const MONGODB_URI = 'mongodb+srv://adminvoting:Password123@cluster0.fshemrp.mongodb.net/votingdb?appName=Cluster0'; 

const finalisSchema = new mongoose.Schema({
    id: String,
    nomor: String,
    nama: String,
    vote: Number,
    foto: String
});
const Finalis = mongoose.models.Finalis || mongoose.model('Finalis', finalisSchema);

const connectDB = async () => {
    if (mongoose.connection.readyState >= 1) return;
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    
    const jumlahData = await Finalis.countDocuments();
    if (jumlahData === 0) {
        await Finalis.insertMany([
            { id: 'bujang_1', nomor: '01', nama: 'Andi Pratama (Bujang)', vote: 10, foto: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=300' },
            { id: 'gadis_1', nomor: '02', nama: 'Siti Rahma (Gadis)', vote: 15, foto: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=300' },
            { id: 'bujang_2', nomor: '03', nama: 'Rian Hidayat (Bujang)', vote: 5, foto: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=300' }
        ]);
    }
};

// --- 2. KONFIGURASI MIDTRANS ---
const snap = new midtransClient.Snap({
    isProduction: false,
    serverKey: 'Mid-server-x4V0sK8bbsKoYL6xpHRBFfY9'
});
let hargaPerVote = 5000;

// --- RUTE HALAMAN ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

// --- 3. API: AMBIL DATA ---
app.get('/api/finalis', async (req, res) => {
    try {
        await connectDB();
        const dataFinalis = await Finalis.find({});
        res.json(dataFinalis);
    } catch (error) {
        res.status(500).json({ error: 'Gagal mengambil data' });
    }
});

// --- 4. API: PEMBAYARAN MIDTRANS (DIPERBARUI & AMAN) ---
app.post('/api/bayar-vote', async (req, res) => {
    try {
        await connectDB();
        const { id_finalis, jumlah_vote, nama_voter } = req.body;
        
        if (!id_finalis || !jumlah_vote) {
            return res.status(400).json({ error: 'Data vote tidak lengkap' });
        }

        const totalHarga = parseInt(jumlah_vote) * hargaPerVote;
        const orderId = `VOTE-${id_finalis}-${Date.now()}`;

        let parameter = {
            transaction_details: { 
                order_id: orderId, 
                gross_amount: totalHarga 
            },
            credit_card: { secure: true },
            customer_details: { 
                first_name: nama_voter || 'Pendukung', 
                email: 'voter@example.com' 
            },
            custom_field1: id_finalis,
            custom_field2: jumlah_vote.toString()
        };

        const transaction = await snap.createTransaction(parameter);
        res.json({ token: transaction.token });
        
    } catch (error) {
        console.error('Error Midtrans:', error.message);
        res.status(500).json({ 
            error: 'Gagal membuat pembayaran dari Midtrans', 
            detail: error.message 
        });
    }
});

// --- 5. API: WEBHOOK ---
app.post('/api/webhook', async (req, res) => {
    const notif = req.body;
    try {
        await connectDB();
        const statusResponse = await snap.transaction.notification(notif);
        if ((statusResponse.transaction_status == 'capture' || statusResponse.transaction_status == 'settlement') && (statusResponse.fraud_status == 'accept' || !statusResponse.fraud_status)) {
            await Finalis.findOneAndUpdate(
                { id: statusResponse.custom_field1 },
                { $inc: { vote: parseInt(statusResponse.custom_field2) } }
            );
        }
        res.status(200).send('OK');
    } catch (error) {
        res.status(500).send('Error');
    }
});

// --- 6. API: ADMIN TAMBAH ---
app.post('/api/admin/tambah', async (req, res) => {
    try {
        await connectDB();
        const { id, nomor, nama, foto } = req.body;
        const finalisBaru = new Finalis({ id, nomor, nama, vote: 0, foto });
        await finalisBaru.save();
        res.json({ message: 'Sukses' });
    } catch (error) {
        res.status(500).json({ error: 'Gagal' });
    }
});

// --- 7. API: ADMIN HAPUS ---
app.delete('/api/admin/hapus/:id', async (req, res) => {
    try {
        await connectDB();
        await Finalis.findOneAndDelete({ id: req.params.id });
        res.json({ message: 'Sukses' });
    } catch (error) {
        res.status(500).json({ error: 'Gagal' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server jalan di port ${PORT}`));
module.exports = app;