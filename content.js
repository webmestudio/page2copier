chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (message.action === "convertToPDF") convertPageToPDF()
})

const scrollDownUntilEnd = () => {
    function isAtPageEnd() {
        return window.scrollY + window.innerHeight >= document.documentElement.scrollHeight
    }
    function scroll() {
        const x = 0
        const y = window.scrollY + window.innerHeight

        window.scrollTo({
            top: y,
            left: x,
        })
        if (!isAtPageEnd()) {
            scroll()
        }
    }
    scroll()
}

const imageUrlToBase64 = (imgSrc) => {
    return new Promise((resolve, reject) => {
        // Fetch the image data as a Blob
        fetch(imgSrc, { mode: 'cors' })
            .then(response => {
                if (!response.ok) {
                    throw new Error('Network response was not ok');
                }
                return response.blob();
            })
            .then(blob => {
                // Read the Blob as a data URL
                const reader = new FileReader();
                reader.onload = function () {
                    resolve(reader.result);
                };
                reader.onerror = function () {
                    resolve(imgSrc)
                };
                reader.readAsDataURL(blob);
            })
            .catch(error => {
                resolve(imgSrc)
            });
    });
};

const replaceImageSourcesWithBase64 = () => {
    const images = document.querySelectorAll('img')
    Array.from(images).forEach(async img => {
        const newSource = imageUrlToBase64(img)
        img.src = newSource
        console.log('newSource', newSource)
    })
}

const waitForAnimations = (delay = 2000) => new Promise(resolve => setTimeout(resolve, delay));

const convertPageToPDF = async () => {
    if (document.readyState !== 'complete') {
        await new Promise(resolve => window.addEventListener('load', resolve));
    }

    console.log("Converting page to PDF...")
    const title = document.querySelector('title')
    const { width } = document.body.getBoundingClientRect()

    window.scrollTo(0, 0)
    document.body.style.width = `${width}px`;
    document.body.style.margin = '0';
    document.body.style.padding = '0';

    let images = document.getElementsByTagName("img");
    for (let i = 0; i < images.length; i++) {
        if (images[i].src.includes('://')) {
            const newSource = await imageUrlToBase64(images[i].src)
            images[i].src = newSource
        }
    }

    // Set dimensions for SVGs
    let svgs = document.getElementsByTagName("svg");
    for (let i = 0; i < svgs.length; i++) {
        if (!svgs[i].getAttribute('width')) {
            svgs[i].setAttribute('width', svgs[i].getBoundingClientRect().width);
        }
        if (!svgs[i].getAttribute('height')) {
            svgs[i].setAttribute('height', svgs[i].getBoundingClientRect().height);
        }
    }

    // Force repaint
    document.body.style.display = 'none';
    document.body.offsetHeight; // Force reflow
    document.body.style.display = '';

    var options = {
        margin: 5,
        filename: `${title ? title.textContent : 'page'}.pdf`,
        image: { type: 'png', quality: 0.8 },
        enableLinks: false,
        html2canvas: {
            width: width,
            windowWidth: width,
            // scale: 2,
            allowTaint: true,
            logging: true,
            useCORS: true,
            dpi: 300,
            imageTimeout: 10000,
            letterRendering: true,
        },
        jsPDF: {
            unit: 'px',
            format: [width, document.body.scrollHeight],
            orientation: 'portrait'
        }
    }

    html2pdf().set(options).from(document.body).save().then(() => {
        chrome.runtime.sendMessage({ action: "processComplete" })
    })
}
