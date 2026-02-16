// api/consult.js
export default async function handler(req, res) {
    // 1. Setup Headers (CORS)
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const { query } = req.body;
    if (!query) return res.status(400).json({ error: "Query is required" });

    const GEMINI_KEY = process.env.GEMINI_API_KEY;
    const BOOKS_KEY = process.env.GOOGLE_BOOKS_API_KEY;

    // Smart Fallback List (Tries your preferred models first)
    const MODEL_PRIORITY = [
        "gemini-2.0-flash",       
        "gemini-2.5-flash",       
        "gemini-2.5-flash-lite",  
        "gemini-1.5-flash"
    ];

    try {
        // --- STEP A: Ask Gemini (The "Brain") ---
        let bookData = null;
        let lastError = null;

        for (const model of MODEL_PRIORITY) {
            try {
                console.log(`Backend attempting: ${model}`);
                const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`;
                
                const systemPrompt = `
You are The Archivist, a sophisticated and deeply knowledgeable literary expert. 
Your task is to identify or recommend ONE specific book based on: "${query}"

INSTRUCTIONS FOR THE 'REASON' FIELD:
- Do not be brief or generic. 
- Use scholarly, evocative, and atmospheric language.
- Explain the deep thematic connection or historical significance of the book.
- If it is a specific match (quote/plot), explain exactly why this book is the source.
- Maintain the persona of a keeper of ancient scrolls and forgotten knowledge.

RULES:
1. IDENTIFY specific quotes/plots accurately.
2. RECOMMEND vibes with deep literary insight.
3. Output ONLY strict JSON.

JSON STRUCTURE:
{ 
    "title": "Exact Book Title", 
    "author": "Author Name", 
    "reason": "A robust, sophisticated, and evocative explanation of the selection, written in the style of an expert archivist." 
}
`;

                const geminiResponse = await fetch(geminiUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ contents: [{ parts: [{ text: systemPrompt }] }] })
                });

                if (!geminiResponse.ok) throw new Error(`Model ${model} returned ${geminiResponse.status}`);

                const geminiJson = await geminiResponse.json();
                
                if (!geminiJson.candidates || !geminiJson.candidates[0]) {
                    throw new Error(`Model ${model} returned empty candidates`);
                }

                let rawText = geminiJson.candidates[0].content.parts[0].text;
                // Clean up any markdown code blocks the AI might add
                rawText = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
                bookData = JSON.parse(rawText);
                
                break; // It worked!
            } catch (e) {
                console.warn(`Backend: ${model} failed:`, e.message);
                lastError = e;
            }
        }

        if (!bookData) {
            throw new Error("All Archivist models failed. Last error: " + lastError?.message);
        }

        // --- STEP B: Ask Google Books (The "Library") ---
        const cleanTitle = bookData.title.replace(/[^\w\s]/gi, '');
        const cleanAuthor = bookData.author.replace(/[^\w\s]/gi, '');
        const booksUrl = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(cleanTitle + " " + cleanAuthor)}&maxResults=1&key=${BOOKS_KEY}`;
        
        const booksResponse = await fetch(booksUrl);
        const booksData = await booksResponse.json();
        
        let coverUrl = null;
        let rating = null;
        let count = 0;
        let isbn = null;

        if (booksData.items && booksData.items.length > 0) {
            const info = booksData.items[0].volumeInfo;
            
            // 1. Try to get Google's Cover
            if (info.imageLinks?.thumbnail) {
                coverUrl = info.imageLinks.thumbnail.replace('http:', 'https:');
            }
            
            // 2. Grab other metadata
            rating = info.averageRating || null;
            count = info.ratingsCount || 0;

            // 3. Grab ISBN for the fallback (Check industryIdentifiers)
            if (info.industryIdentifiers) {
                const isbnObj = info.industryIdentifiers.find(id => id.type === "ISBN_13") || info.industryIdentifiers[0];
                if (isbnObj) isbn = isbnObj.identifier;
            }
        }

        // --- STEP C: The Open Library Rescue (Fallback) ---
        // If Google failed to give us a cover, but we have an ISBN, ask Open Library.
        if (!coverUrl && isbn) {
            console.log(`Google failed cover. Trying Open Library for ISBN: ${isbn}`);
            // Size 'L' gives a nice large image.
            coverUrl = `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`;
        }

        res.status(200).json({
            gemini: bookData,
            google: { coverUrl, rating, count }
        });

    } catch (error) {
        console.error("Server Critical Error:", error);
        res.status(500).json({ error: "Failed to fetch data: " + error.message });
    }
}


