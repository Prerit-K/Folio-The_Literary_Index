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
                
                // --- THE ROBUST INSTRUCTIONS ---
                // This mimics the "Raw" logic by defining strict categories.
                const systemPrompt = `
                You are The Archivist, an expert literary database and recommender.
                Your task is to identify or recommend ONE specific book based on the user's input: "${query}"

                STRICT PROTOCOL:
                1. **IDENTIFICATION (Specifics):** - If the input is a **Quote**, **Plot Summary**, **Character Name**, or **Vague Memory** of a specific book, you MUST identify that exact book. Do not recommend a similar one. Find the match.
                
                2. **RECOMMENDATION (Vibes):** - If the input is a **Mood**, **Feeling**, **Genre request**, or **Abstract concept**, recommend the single most evocative, high-quality literary match.

                3. **FORMAT:**
                   - Output strict JSON only.
                   - "reason": Write a single, sophisticated sentence explaining the connection. (e.g., "This is the exact novel containing the quote you recalled." or "A masterwork of isolation that perfectly matches your requested mood.")

                JSON STRUCTURE:
                { 
                    "title": "Exact Book Title", 
                    "author": "Author Name", 
                    "reason": "The Archivist's note." 
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

        if (booksData.items && booksData.items.length > 0) {
            const info = booksData.items[0].volumeInfo;
            // Use High Res if available, otherwise thumbnail
            coverUrl = info.imageLinks?.thumbnail?.replace('http:', 'https:') || null;
            rating = info.averageRating || null;
            count = info.ratingsCount || 0;
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
