/* Landing Page Logic */

document.addEventListener('DOMContentLoaded', () => {
    const landingView = document.getElementById('view-landing');
    const continueBtn = document.getElementById('landing-continue-btn');
    const loadingRing = document.querySelector('.premium-loader');
    const loadingText = document.querySelector('.loading-text');

    // Timer logic: Show CONTINUE button after 4 seconds of animation
    setTimeout(() => {
        if (loadingRing) loadingRing.style.display = 'none';
        if (loadingText) loadingText.innerText = 'System Ready';
        if (continueBtn) {
            continueBtn.style.display = 'block';
            continueBtn.style.animation = 'fadeIn 0.5s ease forwards';
        }
    }, 4000);
    
    // Betting Chip Spawner
    let chipInterval = setInterval(() => {
        if (!landingView.classList.contains('active')) return;
        createFloatingChip();
    }, 1000);

    function createFloatingChip() {
        const chip = document.createElement('div');
        const types = ['', 'red', 'violet'];
        const labels = ['₹10', '₹100', '₹500', '₹1K', 'BIG', 'SMALL', 'RED', 'G'];
        
        const type = types[Math.floor(Math.random() * types.length)];
        chip.className = `floating-chip ${type}`;
        chip.innerText = labels[Math.floor(Math.random() * labels.length)];
        
        const targetX = Math.floor(Math.random() * 100) + '%';
        chip.style.setProperty('--target-x', targetX);
        chip.style.left = '50%';
        
        landingView.appendChild(chip);
        setTimeout(() => chip.remove(), 3000);
    }
});

// New function to manually advance to Auth Section
window.showLandingAuth = function() {
    const loader = document.getElementById('landing-loader');
    const welcomeText = document.getElementById('landing-welcome-text');
    const authSection = document.getElementById('landing-auth-section');

    if (loader) loader.style.display = 'none';
    if (welcomeText) {
        welcomeText.style.display = 'block';
        welcomeText.style.animation = 'fadeIn 1s ease forwards';
    }
    if (authSection) {
        authSection.style.display = 'block';
        authSection.style.animation = 'fadeIn 1s ease forwards';
    }
}

// Global functions for Landing Auth
window.handleLandingAuth = async function() {
    const phone = document.getElementById('landing-reg-user').value.trim();
    const pass = document.getElementById('landing-reg-pass').value.trim();
    
    if (!phone || !pass) {
        return showToast('Please enter your details to register', true);
    }

    // Standard Validation
    if(!/^\d{10}$/.test(phone)) {
        return showToast('Phone number must be exactly 10 digits', true);
    }
    if(pass.length < 4 || pass.length > 12) {
        return showToast('Password must be between 4-12 characters', true);
    }

    showToast('Creating your account...');

    try {
        // 1. Prepare User Data (Consistent with index.html)
        const newUser = {
            id: Date.now(),
            phoneNumber: phone,
            password: pass,
            name: phone,
            balance: 0,
            role: 'USER',
            createdAt: new Date().toISOString()
        };

        // 2. Save Locally (Mirror logic from index.html)
        let localUsers = JSON.parse(localStorage.getItem('local_users_db') || '[]');
        if(!localUsers.some(u => u.phoneNumber === phone)) {
            localUsers.push(newUser);
            localStorage.setItem('local_users_db', JSON.stringify(localUsers));
        }

        // 3. Register on Server
        const res = await fetch(`${API_URL}/api/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newUser)
        });

        if (res.status === 409) {
            showToast('Account already exists. Logging you in...');
        } else if (!res.ok) {
            throw new Error("Registration failed");
        } else {
            showToast('Registration Successful!');
        }

        // 4. Auto-Login Flow
        const loginUserField = document.getElementById('loginUsername');
        const loginPassField = document.getElementById('loginPassword');
        if (loginUserField) loginUserField.value = phone;
        if (loginPassField) loginPassField.value = pass;
        
        // Use the global login function from index.html
        if (typeof loginUser === 'function') {
            await loginUser();
        } else {
            // Fallback if loginUser isn't found
            switchView('view-user-login');
        }

    } catch (err) {
        console.warn("Server sync failed, but local registration succeeded:", err);
        // Local registration already done above — just auto login
        showToast('Registration Successful!');
        const loginUserField = document.getElementById('loginUsername');
        const loginPassField = document.getElementById('loginPassword');
        if (loginUserField) loginUserField.value = phone;
        if (loginPassField) loginPassField.value = pass;
        if (typeof loginUser === 'function') {
            await loginUser();
        } else {
            switchView('view-user-login');
        }
    }
}
