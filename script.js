// Priority List: Tries the first one. If it fails (quota/error), moves to the next.
const MODEL_PRIORITY = [
    "gemini-2.5-flash",       // Best balance of speed & smarts
    "gemini-2.5-flash-lite",  // Very low quota usage (Backup 1)
    "gemini-2.0-flash",       // Reliable standard (Backup 2)
    "gemini-2.0-flash-lite"   // Ultimate fallback
];

// --- DOM Elements ---
const inputField = document.getElementById("query");
const consultBtn = document.getElementById("consult-btn");
const loader = document.getElementById("loader");
const modalOverlay = document.getElementById("modal-overlay");
const closeBtn = document.getElementById("close-btn");

// Result Elements
const titleEl = document.getElementById("book-title");
const authorEl = document.getElementById("book-author");
const reasonEl = document.getElementById("book-reason");
const ratingEl = document.getElementById("book-rating");
const coverImg = document.getElementById("book-cover");
const coverFallback = document.getElementById("cover-fallback");

// --- Event Listeners ---
consultBtn.addEventListener("click", handleConsultation);
closeBtn.addEventListener("click", closeModal);
modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) closeModal();
});

// --- Main Logic ---

async function handleConsultation() {
    const userQuery = inputField.value.trim();
    if (!userQuery) return;

    setLoading(true);

    try {
        // CALL YOUR NEW VERCEL BACKEND
        const response = await fetch('/api/consult', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: userQuery })
        });

        if (!response.ok) throw new Error("Archivist unavailable");

        const data = await response.json();

        // The backend now returns exactly what displayResult needs
        displayResult(data.gemini, data.google);

    } catch (error) {
        console.error("Error:", error);
        alert("The Archivist is currently unreachable. Please try again later.");
    } finally {
        setLoading(false);
    }
}

// --- UI Helpers ---

function displayResult(geminiData, googleData) {
    // 1. Fill in the Text
    titleEl.textContent = geminiData.title;
    authorEl.textContent = geminiData.author;
    reasonEl.textContent = geminiData.reason;
    
    if (googleData.rating) {
        ratingEl.textContent = `User Rating: ${googleData.rating}/5 (${googleData.count} votes)`;
    } else {
        ratingEl.textContent = "Unrated in catalogue";
    }

    // 2. Prepare the "Pretty" Fallback HTML
    coverFallback.innerHTML = `
        <div class="fallback-title">${geminiData.title}</div>
        <div class="fallback-author">${geminiData.author}</div>
    `;

    // 3. Image Handling with Safety Check
    if (googleData.coverUrl) {
        const highRes = googleData.coverUrl.replace('&zoom=1', '&zoom=2'); 
        
        const tempImg = new Image();
        tempImg.src = highRes;

        tempImg.onload = function() {
            // THE FIX: Reject tiny "glitch" images (often 1x1px)
            if (this.naturalWidth < 10) {
                console.log("Image is a dud (1x1 pixel). Showing fallback.");
                showFallback();
            } else {
                coverImg.src = highRes;
                coverImg.classList.remove("hidden");
                coverFallback.classList.add("hidden");
            }
        };

        tempImg.onerror = function() {
            showFallback();
        };

    } else {
        showFallback();
    }

    // 4. Open Modal
    modalOverlay.classList.remove("hidden");
    pushModalState();
}

// Helper Function
function showFallback() {
    coverImg.classList.add("hidden");
    coverFallback.classList.remove("hidden");
}

function closeModal(goBack = true) {
    modalOverlay.classList.add("hidden");
    setTimeout(() => {
        coverImg.src = "";
    }, 300);
    
    // Now 'goBack' is defined, so this won't crash!
    if (goBack && history.state && history.state.modalOpen) {
        history.back();
    }
}

function setLoading(isLoading) {
    if (isLoading) {
        loader.classList.remove("hidden");
        consultBtn.disabled = true;
        consultBtn.style.opacity = "0.5";
    } else {
        loader.classList.add("hidden");
        consultBtn.disabled = false;
        consultBtn.style.opacity = "1";
    }
}

// --- PWA & Mobile Logic ---

// 1. Service Worker Registration
if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("/sw.js")
            .then(reg => console.log("Service Worker Registered"))
            .catch(err => console.log("SW Fail:", err));
    });
}

// 2. Handle "Back" Button to Close Modal
function pushModalState() {
    // Pushes a state to the browser history when the modal opens
    history.pushState({ modalOpen: true }, "Modal Open", "#result");
}

// Listen for the "Back" action (popstate)
window.addEventListener("popstate", (event) => {
    // If the user presses back on their phone/browser, close the modal visually
    if (!modalOverlay.classList.contains("hidden")) {
        closeModal(false); // Pass false so it doesn't try to go back twice
    }

});

