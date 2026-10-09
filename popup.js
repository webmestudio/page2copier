document.addEventListener("DOMContentLoaded", function () {
    const convertButton = document.getElementById("convertButton")
    if (convertButton) {
        convertButton.addEventListener("click", function () {
            const loader = document.querySelector('.loader')
            const loaderText = document.querySelector('.loaderText')
            if (loader) loader.style.display = 'block'
            if (loaderText) loaderText.style.display = 'block'
            convertButton.style.display = 'none'

            chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
                chrome.tabs.sendMessage(tabs[0].id, { action: "convertToPDF" })
            })
        })
    }

    chrome.runtime.onMessage.addListener(function (message) {
        if (message.action === "processComplete") {
            window.close()
        }
    })
})
