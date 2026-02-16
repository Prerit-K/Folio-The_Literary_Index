// api/consult.js
export default async function handler(req, res) {
    // --- 1. Setup Headers (CORS) ---
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

    // --- 2. Validate Request ---
    const { query } = req.body || {}; 
    if (!query) return res.status(400).json({ error: "Query is required" });

    const GEMINI_KEY = process.env.GEMINI_API_KEY;
    const BOOKS_KEY = process.env.GOOGLE_BOOKS_API_KEY;

    if (!GEMINI_KEY || !BOOKS_KEY) {
        console.error("Missing API Keys");
        return res.status(500).json({ error: "Server Configuration Error" });
    }

    const MODEL_PRIORITY = [
        "gemini-2.0-flash",       
        "gemini-2.5-flash",       
        "gemini-2.5-flash-lite",  
        "gemini-1.5-flash"
    ];

    try {
        // --- STEP A: Ask Gemini (The Archivist) ---
        let bookData = null;
        let lastError = null;

        for (const model of MODEL_PRIORITY) {
            try {
                console.log(`Backend attempting: ${model}`);
                const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`;
                
                const systemPrompt = `
You are The Archivist, a sophisticated literary expert.
Your goal is to recommend ONE specific book based on the user's input. 

LOGIC MAP:
1. SYNOPSIS/DESCRIPTION -> Identify the book.
2. SPECIFIC QUOTE -> Identify the book.
3. VIBE/FEELING -> Recommend the best matching literary work.

INSTRUCTIONS:
- Use sophisticated, evocative, "ink-and-paper" style language.
- Reason length: 25-40 words. 
- Maintain a mysterious yet helpful persona.

Output JSON ONLY:
{ 
    "title": "Exact Book Title", 
    "author": "Author Name", 
    "reason": "Archivist's note."
}
User Input: "${query}"
`;
                const geminiResponse = await fetch(geminiUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ contents: [{ parts: [{ text: systemPrompt }] }] })
                });

                if (!geminiResponse.ok) throw new Error(`Model ${model} returned ${geminiResponse.status}`);
                const geminiJson = await geminiResponse.json();
                
                let rawText = geminiJson.candidates[0].content.parts[0].text;
                rawText = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
                bookData = JSON.parse(rawText);
                break; 
            } catch (e) {
                console.warn(`Backend: ${model} failed:`, e.message);
                lastError = e;
            }
        }

        if (!bookData) throw new Error("All Archivist models failed.");

        // --- STEP B: Ask Google Books (The Library) ---
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
            if (info.imageLinks?.thumbnail) {
                coverUrl = info.imageLinks.thumbnail.replace('http:', 'https:');
            }
            rating = info.averageRating || null;
            count = info.ratingsCount || 0;
            if (info.industryIdentifiers) {
                const isbnObj = info.industryIdentifiers.find(id => id.type === "ISBN_13") || info.industryIdentifiers[0];
                if (isbnObj) isbn = isbnObj.identifier;
            }
        }

        // --- STEP C: The Open Library Rescue (The "Fuzzy" Fallback) ---
        if (!coverUrl) {
            console.log("Google failed cover. Initiating Open Library Rescue...");

            // Sub-Strategy 1: Try ISBN Direct (Fastest)
            if (isbn) {
                const isbnUrl = `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`;
                try {
                    const check = await fetch(isbnUrl, { method: 'HEAD' });
                    if (check.ok) coverUrl = isbnUrl;
                } catch (e) { console.warn("OL ISBN check failed"); }
            }

            // Sub-Strategy 2: The "Fuzzy" Search (Smartest)
            // If ISBN failed or didn't exist, we search OL for the Title+Author manually
            if (!coverUrl) {
                console.log(`ISBN failed. Searching Open Library for: ${cleanTitle} by ${cleanAuthor}`);
                const searchUrl = `https://openlibrary.org/search.json?title=${encodeURIComponent(cleanTitle)}&author=${encodeURIComponent(cleanAuthor)}&limit=1`;
                
                try {
                    const searchRes = await fetch(searchUrl);
                    const searchData = await searchRes.json();
                    
                    if (searchData.docs && searchData.docs.length > 0) {
                        const doc = searchData.docs[0];
                        if (doc.cover_i) {
                            coverUrl = `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`;
                            console.log("Found cover via Fuzzy Search!");
                        }
                    }
                } catch (e) {
                    console.warn("OL Fuzzy Search failed:", e.message);
                }
            }
        }

        // --- STEP D: Final Response ---
        res.status(200).json({
            gemini: bookData,
            google: { 
                coverUrl: coverUrl, 
                rating: rating, 
                count: count 
            }
        });

    } catch (error) {
        console.error("Server Critical Error:", error);
        res.status(500).json({ error: "Archivist error: " + error.message });
    }
}
