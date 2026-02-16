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
        console.error("Missing API Keys in Environment Variables");
        return res.status(500).json({ error: "Server Configuration Error: Missing Keys" });
    }

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
                
                // --- THE ROBUST PROMPT INJECTION ---
                const systemPrompt = `
You are The Archivist, a sophisticated and deeply knowledgeable literary expert.

Your goal is to recommend ONE specific book based on the user's input. You must analyze the nature of the input to decide your action:

LOGIC MAP:
1. If Input is a SYNOPSIS or DESCRIPTION -> Identify the specific book they are describing.
2. If Input is a SPECIFIC QUOTE -> Identify the book that contains this quote.
3. If Input is a VIBE, MOOD, or FEELING -> Recommend the single best matching literary work (novel, poetry, or non-fiction).

INSTRUCTIONS FOR THE 'REASON' FIELD:
- Use sophisticated, evocative, and "ink-and-paper" style language.
- Limit the length to between 25 and 40 words. 
- Do not just summarize the plot; explain the atmospheric or thematic connection to the user's inquiry.
- Maintain a mysterious yet helpful persona.

Strictly Output JSON ONLY with this format:
{ 
    "title": "Exact Book Title", 
    "author": "Author Name", 
    "reason": "A sophisticated and evocative Archivist's note, precisely 25-40 words long."
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
                
                if (!geminiJson.candidates || !geminiJson.candidates[0]) {
                    throw new Error(`Model ${model} returned empty candidates`);
                }

                let rawText = geminiJson.candidates[0].content.parts[0].text;
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

            // 3. Grab ISBN for the fallback
            if (info.industryIdentifiers) {
                const isbnObj = info.industryIdentifiers.find(id => id.type === "ISBN_13") || info.industryIdentifiers[0];
                if (isbnObj) isbn = isbnObj.identifier;
            }
        }

        // --- STEP C: The Open Library Rescue (Fallback) ---
        if (!coverUrl && isbn) {
            console.log(`Google failed cover. Trying Open Library for ISBN: ${isbn}`);
            
            const openLibraryUrl = `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`;
            
            try {
                // The HEAD check
                const checkResponse = await fetch(openLibraryUrl, { method: 'HEAD' });
                
                if (checkResponse.ok) {
                    coverUrl = openLibraryUrl; 
                } else {
                    console.log("Open Library returned 404. No cover found.");
                    coverUrl = null; 
                }
            } catch (err) {
                console.warn("Open Library check failed:", err.message);
                coverUrl = null;
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
