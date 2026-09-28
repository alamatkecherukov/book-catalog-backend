require('dotenv').config();
const jwt = require('jsonwebtoken');
const fs = require('fs');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const PORT = process.env.PORT || 3000;
const BOOKS_FILE = 'books.json';

// ========== ФУНКЦИИ РАБОТЫ С ФАЙЛОМ ==========
function readBooks() {
    let data = fs.readFileSync(BOOKS_FILE, 'utf-8');
    return JSON.parse(data);
}

function writeBooks(books) {
    fs.writeFileSync(BOOKS_FILE, JSON.stringify(books, null, 2));
}

// ========== MIDDLEWARE АВТОРИЗАЦИИ ==========
function auth(req, res, next) {
    let token = req.headers.authorization;
    if (!token) {
        return res.status(401).json({ error: 'Нет токена' });
    }
    try {
        jwt.verify(token, JWT_SECRET);
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Невалидный токен' });
    }
}

// ========== ПУБЛИЧНЫЕ МАРШРУТЫ ==========

// Главная
app.get('/', (req, res) => {
    res.send('Server work');
});

// Список всех книг
app.get('/books', (req, res) => {
    res.json(readBooks());
});

// Одна книга по id
app.get('/books/:id', (req, res) => {
    let books = readBooks();
    let id = Number(req.params.id);
    let book = books.find(b => b.id === id);

    if (!book) {
        return res.status(404).json({ error: 'Книга не найдена' });
    }

    res.json(book);
});

// Логин админа
app.post('/login', (req, res) => {
    if (req.body.password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Неверный пароль' });
    }
    let token = jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token });
});

// Заказ — публичный, отправляет в Telegram
app.post('/order', async (req, res) => {
    let { bookId, contact } = req.body;

    if (!bookId || !contact) {
        return res.status(400).json({ error: 'Не хватает данных' });
    }

    let books = readBooks();
    let book = books.find(b => b.id === Number(bookId));

    if (!book) {
        return res.status(404).json({ error: 'Книга не найдена' });
    }

    try {
        await sendOrderToTelegram(book, contact);
        res.json({ success: true });
    } catch (e) {
        console.error('Telegram error:', e.message);
        res.status(500).json({ error: 'Не удалось отправить заказ' });
    }
});

// ========== ЗАЩИЩЁННЫЕ МАРШРУТЫ ==========

// Добавить книгу
app.post('/books', auth, (req, res) => {
    let books = readBooks();
    let { name, img, shortOpis, price, fullOpis, material } = req.body;

    if (!name || !price) {
        return res.status(400).json({ error: 'Название и цена обязательны' });
    }

    let newId = books.length > 0
        ? Math.max(...books.map(b => b.id)) + 1
        : 1;

    let add = {
        id: newId,
        name,
        img: img || '',
        shortOpis: shortOpis || '',
        price: Number(price),
        fullOpis: fullOpis || '',
        material: material || ''
    };

    books.push(add);
    writeBooks(books);

    res.json({ success: true, book: add });
});

// Удалить книгу
app.delete('/books/:id', auth, (req, res) => {
    let books = readBooks();
    let id = Number(req.params.id);
    let before = books.length;

    books = books.filter(b => b.id !== id);

    if (books.length === before) {
        return res.status(404).json({ error: 'Книга не найдена' });
    }

    writeBooks(books);
    res.json({ success: true });
});

// ========== TELEGRAM ==========
async function sendOrderToTelegram(book, contact) {
    const TG_TOKEN = process.env.TG_TOKEN;
    const TG_CHAT_ID = process.env.TG_CHAT_ID;
    const SITE_URL = process.env.SITE_URL || 'http://localhost:5500';

    const bookUrl = `${SITE_URL}/book.html?id=${book.id}`;

    const text =
        `📚 <b>Новый заказ!</b>\n\n` +
        `Книга: ${book.name}\n` +
        `Цена: ${book.price} руб.\n` +
        `Контакт клиента: ${contact}\n\n` +
        `🔗 <a href="${bookUrl}">Открыть страницу товара</a>`;

    const url = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: TG_CHAT_ID,
            text: text,
            parse_mode: 'HTML'
        })
    });

    if (!response.ok) {
        let err = await response.text();
        throw new Error('Telegram API: ' + err);
    }
}

// ========== ЗАПУСК ==========
app.listen(PORT, () => {
    console.log(`Сервер запущен: http://localhost:${PORT}`);
});