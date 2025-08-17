document.addEventListener('DOMContentLoaded', () => {
  const userIdInput = document.getElementById('userId');
  const saveButton = document.getElementById('save');
  const statusDiv = document.getElementById('status');

  // Load the saved userId when the popup opens
  chrome.storage.local.get(['userId'], (result) => {
    if (result.userId) {
      userIdInput.value = result.userId;
    }
  });

  // Save the userId when the save button is clicked
  saveButton.addEventListener('click', () => {
    const userId = userIdInput.value.trim();
    if (userId) {
      chrome.storage.local.set({ userId: userId }, () => {
        statusDiv.textContent = 'ID saved!';
        setTimeout(() => { statusDiv.textContent = ''; }, 2000);
      });
    } else {
      statusDiv.textContent = 'Please enter an ID.';
    }
  });
});
