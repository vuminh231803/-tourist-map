const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const app = express();

app.use(express.json());

// Cấu hình CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Content-Disposition'],
}));

// Phục vụ file tĩnh
app.use(express.static(path.join(__dirname)));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Cấu hình multer để xử lý upload ảnh
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath);
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  },
});
const upload = multer({ storage: storage });

// Cấu hình kết nối PostgreSQL
const pool = new Pool({
  user: 'postgres',
  host: '127.0.0.1',
  database: 'hanoi_tourism',
  password: '123456',
  port: 5432,
});

// Route mặc định phục vụ giao diện
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// API lấy tất cả địa điểm (đã thêm các trường bổ sung)
app.get('/api/places', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ogc_fid, name, type, address, ST_AsText(wkb_geometry) AS coordinates, image,
              description, phone, opening_hours, website
       FROM places
       ORDER BY ogc_fid`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Lỗi khi lấy danh sách địa điểm:', error);
    res.status(500).json({ error: 'Không thể lấy danh sách địa điểm' });
  }
});

// API lấy một địa điểm theo ID
app.get('/api/places/:ogc_fid', async (req, res) => {
  const { ogc_fid } = req.params;
  try {
    const result = await pool.query(
      `SELECT ogc_fid, name, type, address, ST_AsText(wkb_geometry) AS coordinates, image,
              description, phone, opening_hours, website
       FROM places
       WHERE ogc_fid = $1`,
      [ogc_fid]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Địa điểm không tồn tại' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Lỗi khi lấy địa điểm:', error);
    res.status(500).json({ error: 'Không thể lấy địa điểm' });
  }
});

// API thêm địa điểm mới
app.post('/api/places', upload.single('image'), async (req, res) => {
  const { name, type, address, wkb_geometry, description, phone, opening_hours, website } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : null;
  if (!name || !type || !wkb_geometry) {
    return res.status(400).json({ error: 'Thiếu thông tin bắt buộc' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO places (name, type, address, wkb_geometry, image, description, phone, opening_hours, website)
       VALUES ($1, $2, $3, ST_GeomFromText($4, 4326), $5, $6, $7, $8, $9)
       RETURNING ogc_fid`,
      [name, type, address || null, wkb_geometry, image, description, phone, opening_hours, website]
    );
    res.status(201).json({ ogc_fid: result.rows[0].ogc_fid });
  } catch (error) {
    console.error('Lỗi khi thêm địa điểm:', error);
    res.status(500).json({ error: 'Không thể thêm địa điểm' });
  }
});

// API cập nhật địa điểm
app.put('/api/places/:ogc_fid', upload.single('image'), async (req, res) => {
  const { ogc_fid } = req.params;
  const { name, type, address, wkb_geometry, existingImage, description, phone, opening_hours, website } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : existingImage;
  if (!name || !type || !wkb_geometry) {
    return res.status(400).json({ error: 'Thiếu thông tin bắt buộc' });
  }
  try {
    const result = await pool.query(
      `UPDATE places
       SET name = $1, type = $2, address = $3, wkb_geometry = ST_GeomFromText($4, 4326),
           image = $5, description = $6, phone = $7, opening_hours = $8, website = $9
       WHERE ogc_fid = $10`,
      [name, type, address || null, wkb_geometry, image, description, phone, opening_hours, website, ogc_fid]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Địa điểm không tồn tại' });
    }
    res.sendStatus(200);
  } catch (error) {
    console.error('Lỗi khi sửa địa điểm:', error);
    res.status(500).json({ error: 'Không thể sửa địa điểm' });
  }
});

// API xóa địa điểm
app.delete('/api/places/:ogc_fid', async (req, res) => {
  const { ogc_fid } = req.params;
  try {
    const result = await pool.query('SELECT image FROM places WHERE ogc_fid = $1', [ogc_fid]);
    const oldImage = result.rows[0]?.image;

    const deleteResult = await pool.query('DELETE FROM places WHERE ogc_fid = $1', [ogc_fid]);
    if (deleteResult.rowCount === 0) {
      return res.status(404).json({ error: 'Địa điểm không tồn tại' });
    }

    if (oldImage && oldImage.startsWith('/uploads/')) {
      const imagePath = path.join(__dirname, oldImage.slice(1));
      fs.unlink(imagePath, (err) => {
        if (err) console.error('Lỗi xóa file ảnh:', err);
      });
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Lỗi khi xóa địa điểm:', error);
    res.status(500).json({ error: 'Không thể xóa địa điểm' });
  }
});

// Chạy server
app.listen(3001, () => {
  console.log('Server running on port 3001');
  const uploadPath = path.join(__dirname, 'uploads');
  if (!fs.existsSync(uploadPath)) {
    fs.mkdirSync(uploadPath);
    console.log('Thư mục uploads đã được tạo.');
  }
});
