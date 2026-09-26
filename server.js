const express = require('express');
const mongoose = require('mongoose');
const midtransClient = require('midtrans-client');
const path = require('path');

const app = express();

// Middleware penting untuk membaca JSON dan file statis (HTML, CSS, dll)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// Konfigurasi MongoDB Atlas (Ganti dengan URI database Anda jika perlu)
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://username:password@cluster.mongodb.net/db_voting?retryWrites=true&w=majority";

mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log("Berhasil terhubung ke MongoDB Atlas");
}).catch(err => {
    console.error("Koneksi MongoDB gagal:", err);
});

// Schema & Model Finalis
const finalisSchema = new mongoose.Schema({
    nama: { type: String, required: true },
    nomor: { type: String, required: true },
    kategori: { type: String, enum: ['bujang', 'gadis'], required: true }, // 'bujang' atau 'gadis'
    foto: { type: String, required: true },
    vote: { type: Number, default: 0 }
});

const Finalis = mongoose.model('Finalis', finalisSchema);

// Schema Riwayat Transaksi
const transaksiSchema = new mongoose.Schema({
    order_id: { type: String, required: true, unique: true },
    id_finalis: { type: mongoose.Schema.Types.ObjectId, ref: 'Finalis' },
    nama_voter: String,
    jumlah_vote: Number,
    gross_amount: Number,
    status: { type: String, default: 'pending' },
    tanggal: { type: Date, default: Date.now }
});

const Transaksi = mongoose.model('Transaksi', transaksiSchema);

// Inisialisasi Midtrans Snap API (Ganti dengan Server Key Anda)
let snap = new midtransClient.Snap({
    isProduction: false, // Ubah ke true jika sudah mode live/production
    serverKey: process.env.MIDTRANS_SERVER_KEY || 'SB-Mid-server-KODE_SERVER_KEY_ANDA',
    clientKey: process.env.MIDTRANS_CLIENT_KEY || 'SB-Mid-client-KODE_CLIENT_KEY_ANDA'
});

// API: Mendapatkan daftar semua finalis (bisa difilter berdasarkan kategori ?kategori=bujang/gadis)
app.get('/api/finalis', async (req, res) => {
    try {
        const { kategori } = req.query;
        let query = {};
        if (kategori) {
            query.kategori = kategori;
        }
        const data = await Finalis.find(query);
        // Format mapping agar "_id" menjadi "id" di sisi frontend
        const formattedData = data.map(item => ({
            id: item._id,
            nama: item.nama,
            nomor: item.nomor,
            kategori: item.kategori,
            foto: item.foto,
            vote: item.vote
        }));
        res.json(formattedData);
    } catch (error) {
        console.error('Error get finalis:', error);
        res.status(500).json({ error: 'Gagal mengambil data finalis' });
    }
});

// API: Membuat transaksi pembayaran vote via Midtrans
app.post('/api/bayar-vote', async (req, res) => {
    try {
        const { id_finalis, jumlah_vote, nama_voter } = req.body;
        
        const finalis = await Finalis.findById(id_finalis);
        if (!finalis) {
            return res.status(404).json({ error: 'Finalis tidak ditemukan' });
        }

        const hargaPerVote = 5000;
        const totalHarga = jumlah_vote * hargaPerVote;

        // Pembersihan order_id sesuai standar aturan karakter alfanumerik & simbol yang diizinkan Midtrans
        const rawOrderId = `VOTE-${id_finalis}-${Date.now()}`;
        const cleanOrderId = rawOrderId.replace(/[^a-zA-Z0-9\-_.~]/g, '_');

        const parameter = {
            transaction_details: {
                order_id: cleanOrderId,
                gross_amount: totalHarga
            },
            customer_details: {
                first_name: nama_voter || 'Pendukung'
            },
            item_details: [{
                id: finalis._id.toString(),
                price: hargaPerVote,
                quantity: jumlah_vote,
                name: `Vote ${finalis.nama} (${jumlah_vote}x)`
            }]
        };

        // Simpan transaksi status pending ke database
        await Transaksi.create({
            order_id: cleanOrderId,
            id_finalis: finalis._id,
            nama_voter: nama_voter || 'Pendukung',
            jumlah_vote: parseInt(jumlah_vote),
            gross_amount: totalHarga,
            status: 'pending'
        });

        // Request token snap ke Midtrans
        const transaction = await snap.createTransaction(parameter);
        res.json({ token: transaction.token, order_id: cleanOrderId });

    } catch (error) {
        console.error('Midtrans Error:', error.ApiResponse || error);
        res.status(500).json({ error: 'Gagal membuat transaksi pembayaran', detail: error.message });
    }
});

// API: Webhook / Notification Handler dari Midtrans setelah pembayaran selesai
app.post('/api/midtrans-notification', async (req, res) => {
    try {
        const notificationStatus = await snap.transaction.notification(req.body);
        const orderId = notificationStatus.order_id;
        const transactionStatus = notificationStatus.transaction_status;
        const fraudStatus = notificationStatus.fraud_status;

        const transaksi = await Transaksi.findOne({ order_id: orderId });
        if (!transaksi) {
            return res.status(404).json({ message: 'Transaksi tidak ditemukan' });
        }

        if (transactionStatus == 'capture') {
            if (fraudStatus == 'challenge') {
                transaksi.status = 'challenge';
            } else if (fraudStatus == 'accept') {
                transaksi.status = 'success';
                await tambahVoteFinalis(transaksi.id_finalis, transaksi.jumlah_vote);
            }
        } else if (transactionStatus == 'settlement') {
            transaksi.status = 'success';
            await tambahVoteFinalis(transaksi.id_finalis, transaksi.jumlah_vote);
        } else if (transactionStatus == 'cancel' || transactionStatus == 'deny' || transactionStatus == 'expire') {
            transaksi.status = 'failed';
        }

        await transaksi.save();
        res.status(200).json({ status: 'OK' });
    } catch (error) {
        console.error('Notification error:', error);
        res.status(500).json({ error: 'Gagal memproses notifikasi' });
    }
});

async function tambahVoteFinalis(idFinalis, jumlah) {
    await Finalis.findByIdAndUpdate(idFinalis, {
        $inc: { vote: jumlah }
    });
}

// Menjalankan Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server berjalan di port ${PORT}`);
});