// api/consult.js
export default async function handler(req, res) {
    // 1. Setup Headers (Allow your site to talk to this function)
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    // Handle Preflight (Browser checking if it's safe)
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // 2. Get the user query
    const { query } = req.body;
    if (!query) {
        return res.status(400).json({ error: "Query is required" });
    }

    // 3. Get Keys from Environment (Securely)
    const GEMINI_KEY = process.env.GEMINI_API_KEY;
    const BOOKS_KEY = process.env.GOOGLE_BOOKS_API_KEY;

    try {
        // --- STEP A: Ask Gemini ---
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;
        
        const systemPrompt = `
        You are an expert literary archivist. Recommend ONE specific book based on: "${query}".
        Strictly Output JSON ONLY:
        { "title": "Exact Title", "author": "Author Name", "reason": "A single evocative sentence." }
        `;

        const geminiResponse = await fetch(geminiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ parts: [{ text: systemPrompt }] }] })
        });

        const geminiData = await geminiResponse.json();
        let rawText = geminiData.candidates[0].content.parts[0].text;
        // Clean up markdown if Gemini adds it
        rawText = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
        const bookData = JSON.parse(rawText);

        // --- STEP B: Ask Google Books ---
        const cleanTitle = bookData.title.replace(/[^\w\s]/gi, '');
        const cleanAuthor = bookData.author.replace(/[^\w\s]/gi, '');
        const booksUrl = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(cleanTitle + " " + cleanAuthor)}&maxResults=1&key=${BOOKS_KEY}`;
        
        const booksResponse = await fetch(booksUrl);
        const booksData = await booksResponse.json();
        
        let coverUrl = null;
        let rating = null;
        let count = 0;

        if (booksData.items && booksData.items.length > 0) {
            const info = booksData.items[0].volumeInfo;
            coverUrl = info.imageLinks?.thumbnail?.replace('http:', 'https:') || null;
            rating = info.averageRating || null;
            count = info.ratingsCount || 0;
        }

        // --- STEP C: Send Combined Result back to Frontend ---
        res.status(200).json({
            gemini: bookData,
            google: { coverUrl, rating, count }
        });

    } catch (error) {
        console.error("Server Error:", error);
        res.status(500).json({ error: "Failed to fetch data" });
    }
}