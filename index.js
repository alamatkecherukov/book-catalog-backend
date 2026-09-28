require('dotenv').config();
const jwt = require('jsonwebtoken');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const { Octokit } = require('octokit');

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const PORT = process.env.PORT || 3000;

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_FILE = process.env.GITHUB_FILE;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH;

const octokit = new Octokit({ auth: GITHUB_TOKEN });

// ========== ФУНКЦИИ РАБОТЫ С GITHUB ==========
async function readBooks() {
    try {
        const response = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
            owner: GITHUB_OWNER,
            repo: GITHUB_REPO,
            path: GITHUB_FILE,
            ref: GITHUB_BRANCH
        });

        const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
        return JSON.parse(content);
    } catch (e) {
        if (e.status === 404) {
            // Файла нет — создаём пустой
            await writeBooks([]);
            return [];
        }
        throw e;
    }
}

async function writeBooks(books) {
    // Сначала получаем SHA текущего файла (нужен для обновления)
    let sha = undefined;
    try {
        const current = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
            owner: GITHUB_OWNER,
            repo: GITHUB_REPO,
            path: GITHUB_FILE,
            ref: GITHUB_BRANCH
        });
        sha = current.data.sha;
    } catch (e) {
        if (e.status !== 404) throw e;
    }

    // Записываем новый контент
    await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', {
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        path: GITHUB_FILE,
        message: 'update books.json',
        content: Buffer.from(JSON.stringify(books, null, 2)).toString('base64'),
        branch: GITHUB_BRANCH,
        sha: sha
    });
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

app.get('/', (req, res) => {
    res.send('Server work');
});

app.get('/books', async (req, res) => {
    try {
        let books = await readBooks();
        res.json(books);
    } catch (e) {
        console.error('readBooks error:', e.message);
        res.status(500).json({ error: 'Ошибка чтения данных' });
    }
});

app.get('/books/:id', async (req, res) => {
    try {
        let books = await readBooks();
        let id = Number(req.params.id);
        let book = books.find(b => b.id === id);
        if (!book) {
            return res.status(404).json({ error: 'Книга не найдена' });
        }
        res.json(book);
    } catch (e) {
        res.status(500).json({ error: 'Ошибка чтения данных' });
    }
});

app.post('/login', (req, res) => {
    if (req.body.password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Неверный пароль' });
    }
    let token = jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token });
});

app.post('/order', async (req, res) => {
    let { bookId, contact } = req.body;
    if (!bookId || !contact) {
        return res.status(400).json({ error: 'Не хватает данных' });
    }

    try {
        let books = await readBooks();
        let book = books.find(b => b.id === Number(bookId));
        if (!book) {
            return res.status(404).json({ error: 'Книга не найдена' });
        }
        await sendOrderToTelegram(book, contact);
        res.json({ success: true });
    } catch (e) {
        console.error('Order error:', e.message);
        res.status(500).json({ error: 'Не удалось отправить заказ' });
    }
});

// ========== ЗАЩИЩЁННЫЕ МАРШРУТЫ ==========

app.post('/books', auth, async (req, res) => {
    try {
        let books = await readBooks();
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
        await writeBooks(books);

        res.json({ success: true, book: add });
    } catch (e) {
        console.error('Add book error:', e.message);
        res.status(500).json({ error: 'Ошибка сохранения' });
    }
});

app.delete('/books/:id', auth, async (req, res) => {
    try {
        let books = await readBooks();
        let id = Number(req.params.id);
        let before = books.length;

        books = books.filter(b => b.id !== id);

        if (books.length === before) {
            return res.status(404).json({ error: 'Книга не найдена' });
        }

        await writeBooks(books);
        res.json({ success: true });
    } catch (e) {
        console.error('Delete error:', e.message);
        res.status(500).json({ error: 'Ошибка удаления' });
    }
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