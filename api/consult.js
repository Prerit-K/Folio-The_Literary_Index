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

    // Handle Preflight Request
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
        return res.status(500).json({ error: "Server Config Error" });
    }

    // RESTORED: Your original priority list (2.5-flash first)
    const MODEL_PRIORITY = [
        "gemini-2.5-flash",       // Best balance of speed & smarts
        "gemini-2.5-flash-lite",  // Backup 1
        "gemini-2.0-flash",       // Backup 2
        "gemini-2.0-flash-lite"   // Ultimate fallback
    ];

    try {
        // --- STEP A: Ask The Archivist (Gemini) ---
        let bookData = null;
        let lastError = null;

        // RESTORED: The EXACT System Prompt from your script.js
        // This ensures the "Filtering" (Synopsis vs Quote vs Vibe) works exactly like before.
        const systemPrompt = `
        You are an expert literary archivist.
        Your goal is to recommend ONE specific book based on the user's input.
        
        Input can be:
        1. A synopsis/description -> Identify the book.
        2. A specific quote -> Identify the book.
        3. A vibe/feeling -> Recommend the best matching literary work (novel, poetry, or non-fiction).
        
        Strictly Output JSON ONLY with this format:
        {
          "title": "Exact Title",
          "author": "Author Name",
          "reason": "A single, evocative sentence explaining why this fits the user's request."
        }
        
        User Input: "${query}"
        `;

        // Iterate through models (The Fallback Logic)
        for (const model of MODEL_PRIORITY) {
            try {
                const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`;
                
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
                // CLEANUP: Remove markdown formatting to prevent JSON parse errors
                rawText = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
                bookData = JSON.parse(rawText);
                
                break; // Success! Exit loop.
            } catch (e) {
                console.warn(`Backend: ${model} failed:`, e.message);
                lastError = e;
            }
        }

        if (!bookData) {
            throw new Error("All Archivist models failed. Last error: " + lastError?.message);
        }

        // --- STEP B: Ask The Clerk (Google Books) ---
        // RESTORED: The "Clean" logic from script.js
        const cleanTitle = bookData.title.replace(/[^\w\s]/gi, '');
        const cleanAuthor = bookData.author.replace(/[^\w\s]/gi, '');
        
        // RESTORED: The "Broad Search" logic
        const q = `${cleanTitle} ${cleanAuthor}`;
        const booksUrl = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=1&key=${BOOKS_KEY}`;
        
        const booksResponse = await fetch(booksUrl);
        const booksData = await booksResponse.json();
        
        let coverUrl = null;
        let rating = null;
        let count = 0;
        let isbn = null; // For backup

        if (booksData.items && booksData.items.length > 0) {
            const info = booksData.items[0].volumeInfo;
            
            // 1. Image Logic
            if (info.imageLinks?.thumbnail) {
                // FIXED: Replicate the 'High Res' logic you had in script.js
                // Original script: replaced 'http' with 'https' AND 'zoom=1' with 'zoom=2'
                let rawThumb = info.imageLinks.thumbnail;
                rawThumb = rawThumb.replace('http:', 'https:');
                
                // We attempt to upgrade to zoom=2 (High Res) here on the server
                // so the frontend receives the best link immediately.
                coverUrl = rawThumb.replace('&zoom=1', '&zoom=2'); 
            }
            
            // 2. Metadata
            rating = info.averageRating || null;
            count = info.ratingsCount || 0;

            // 3. Grab ISBN (For the Open Library backup)
            if (info.industryIdentifiers) {
                const isbnObj = info.industryIdentifiers.find(id => id.type === "ISBN_13") || info.industryIdentifiers[0];
                if (isbnObj) isbn = isbnObj.identifier;
            }
        }

        // --- STEP C: Open Library Rescue (Optional Backup) ---
        // I kept this because it makes your app better, but it only runs if Google fails.
        if (!coverUrl && isbn) {
            const openLibraryUrl = `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`;
            try {
                const checkResponse = await fetch(openLibraryUrl, { method: 'HEAD' });
                if (checkResponse.ok) coverUrl = openLibraryUrl; 
            } catch (err) {
                console.warn("Open Library check failed");
            }
        }

        // --- STEP D: Return Unified Response ---
        res.status(200).json({
            title: bookData.title,
            author: bookData.author,
            reason: bookData.reason,
            coverUrl: coverUrl,
            rating: rating,
            count: count
        });

    } catch (error) {
        console.error("Server Critical Error:", error);
        res.status(500).json({ error: "Archivist error: " + error.message });
    }
}
