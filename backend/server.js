// --- 1. เรียกใช้ Library ที่จำเป็น ---
require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const axios = require('axios');
const FormData = require('form-data'); // Library ที่ช่วยส่งรูปภาพไปยัง Imagga

// --- 2. ตั้งค่า Express Server ---
const app = express();
const PORT = 3000;
app.use(cors());

// --- 3. ตั้งค่า Multer สำหรับรับไฟล์ ---
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
});

// --- 4. ดึง API Keys จากไฟล์ .env ---
const IMAGGA_API_KEY = process.env.IMAGGA_API_KEY;
const IMAGGA_API_SECRET = process.env.IMAGGA_API_SECRET;
const USDA_API_KEY = process.env.USDA_API_KEY;

// --- 5. สร้าง Endpoint หลักสำหรับวิเคราะห์รูปภาพ ---
app.post('/analyze', upload.single('foodImage'), async (req, res) => {
    console.log("ได้รับคำขอวิเคราะห์รูปภาพ (ใช้ Imagga & USDA)...");

    if (!req.file) {
        return res.status(400).json({ success: false, message: "ไม่พบไฟล์รูปภาพ" });
    }

    try {
        // --- ส่วนที่ 1: วิเคราะห์รูปภาพด้วย Imagga ---
        const form = new FormData();
        form.append('image', req.file.buffer, { filename: req.file.originalname });

        const imaggaResponse = await axios.post('https://api.imagga.com/v2/tags', form, {
            headers: {
                ...form.getHeaders(),
                'Authorization': 'Basic ' + Buffer.from(`${IMAGGA_API_KEY}:${IMAGGA_API_SECRET}`).toString('base64')
            },
            params: {
                limit: 5 // ขอ Tags ที่แม่นยำที่สุด 5 อันดับแรก
            }
        });

        const tags = imaggaResponse.data.result.tags;
        console.log("Imagga Tags:", tags.map(t => t.tag.en));

        const foodKeywords = ['food', 'fruit', 'vegetable', 'meal', 'dish', 'cuisine', 'ingredient', 'dessert', 'produce'];
        const foodTag = tags.find(tag => foodKeywords.includes(tag.tag.en.toLowerCase()) || tag.confidence > 30);

        if (!foodTag) {
            console.log("Imagga ตรวจสอบแล้ว: ไม่ใช่อาหาร");
            return res.status(400).json({ success: false, message: "ไม่พบข้อมูลอาหารในรูปภาพนี้" });
        }
        
        // ใช้ Tag ที่มีความมั่นใจสูงสุดเป็นชื่ออาหาร
        const foodName = tags[0].tag.en;
        console.log(`Imagga ตรวจพบ: ${foodName}`);

        // --- ส่วนที่ 2: ค้นหาข้อมูลโภชนาการด้วย USDA API ---
        const usdaSearchResponse = await axios.get(`https://api.nal.usda.gov/fdc/v1/foods/search`, {
            params: {
                query: foodName,
                api_key: USDA_API_KEY,
                pageSize: 1 // เอาผลลัพธ์ที่ตรงที่สุดอันเดียว
            }
        });

        if (!usdaSearchResponse.data.foods || usdaSearchResponse.data.foods.length === 0) {
            console.log(`ไม่พบข้อมูลโภชนาการสำหรับ: ${foodName} ในฐานข้อมูล USDA`);
            return res.status(404).json({ success: false, message: `ไม่พบข้อมูลโภชนาการสำหรับ '${foodName}'` });
        }

        const foodDetails = usdaSearchResponse.data.foods[0];
        const nutrients = foodDetails.foodNutrients;

        // ฟังก์ชันช่วยหาค่าโภชนาการจาก Array ของ USDA
        const getNutrientValue = (nutrientName, unit) => {
            const nutrient = nutrients.find(n => n.nutrientName.toLowerCase().includes(nutrientName.toLowerCase()));
            return nutrient ? `${nutrient.value.toFixed(1)} ${unit}` : `0 ${unit}`;
        };

        // --- ส่วนที่ 3: รวบรวมข้อมูลและส่งกลับ ---
        const finalResult = {
            success: true,
            name: foodDetails.description, // ใช้ชื่อจากฐานข้อมูล USDA เพื่อความแม่นยำ
            calories: getNutrientValue('Energy', 'kcal'),
            protein: getNutrientValue('Protein', 'g'),
            carbs: getNutrientValue('Carbohydrate, by difference', 'g'),
            fat: getNutrientValue('Total lipid (fat)', 'g'),
            sugar: getNutrientValue('Sugars, total including NLEA', 'g'),
            sodium: getNutrientValue('Sodium, Na', 'mg'),
            imageSrc: `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`
        };
        
        console.log("ส่งผลลัพธ์สำเร็จ");
        res.json(finalResult);

    } catch (error) {
        console.error("เกิดข้อผิดพลาดใน Backend:", error.response ? error.response.data : error.message);
        res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการวิเคราะห์รูปภาพ โปรดลองอีกครั้ง" });
    }
});

// เพิ่มโค้ดส่วนนี้เข้าไปใน server.js
app.get('/', (req, res) => {
    res.send('<h1>Cal Track Backend is running!</h1><p>This server is waiting for image analysis requests from the frontend.</p>');
});

// --- 6. สร้าง Endpoint หลักสำหรับวิเคราะห์รูปภาพ ---
app.post('/analyze', upload.single('foodImage'), async (req, res) => {
    // ... โค้ดวิเคราะห์รูปภาพของคุณ ...
});

// --- 4. เปิดใช้งาน CORS (Cross-Origin Resource Sharing) ---
// อนุญาตให้ Frontend ที่อยู่บน Vercel สามารถเรียกใช้ Backend นี้ได้
const corsOptions = {
  origin: 'https://cal-track-lehduke-winterreasons-projects.vercel.app' // <-- ✨ สำคัญ: ใส่ URL ของ Vercel ของคุณที่นี่
};
app.use(cors(corsOptions));

// --- 6. สั่งให้เซิร์ฟเวอร์เริ่มทำงาน ---
app.listen(PORT, () => {
    console.log(`✅ Backend Server พร้อมทำงานที่ http://localhost:${PORT}`);
    console.log("ใช้ API ฟรีจาก Imagga และ USDA");
});
