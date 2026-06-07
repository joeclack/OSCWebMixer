"use strict";

const channelsDiv = document.getElementById("channels"),
  auxSelect = document.getElementById("aux"),
  panCheckbox = document.getElementById("panning"),
  favourites = document.getElementById("favourites"),
  auxiliaries = document.getElementById("auxiliaries"),
  identityPickerEl = document.getElementById("identityPicker"),
  identityListEl = document.getElementById("identityList");

let ws = null,
  timeout = null,
  rotaPeople = [],
  pendingPersonId = null;

fetch("/auth", { method: "POST" });

function sliderChange(e) {
  const sliderValue = parseFloat(this.value);

  this.parentNode.style.setProperty("--value", sliderValue * 100 + "%");

  if (!ws) {
    return;
  }

  let send = {
    aux: parseInt(auxSelect.options[auxSelect.selectedIndex].dataset.channel),
    channel: parseInt(this.dataset.channel),
  };

  let parameter = "level";
  if (this.classList.contains("panInput")) {
    parameter = "pan";
  }
  send[parameter] = sliderValue;

  ws.send(JSON.stringify(send));
}

function requestValues() {
  ws.send(
    JSON.stringify({
      "aux?": auxSelect.options[auxSelect.selectedIndex].dataset.channel,
    })
  );
}

function applyAuxValues(json) {
  for (let slider of document.getElementsByClassName("volumeInput")) {
    slider.value = json.channels[slider.dataset.channel].level;
    slider.parentNode.style.setProperty("--value", slider.value * 100 + "%");
  }

  for (let slider of document.getElementsByClassName("panInput")) {
    slider.value = json.channels[slider.dataset.channel].pan;
    slider.parentNode.style.setProperty("--value", slider.value * 100 + "%");
  }

  let checkedFavourites = localStorage.getItem(
    "aux" + auxSelect.value + "fav"
  );
  if (checkedFavourites) {
    checkedFavourites = checkedFavourites.split(",");
  } else {
    checkedFavourites = [];
  }

  favourites.checked =
    localStorage.getItem("aux" + auxSelect.value + "favChecked") == "true";

  for (let fav of document.querySelectorAll('input[name="fav[]"]')) {
    fav.checked = checkedFavourites.indexOf(fav.value) != -1;
  }

  favourites.dispatchEvent(new Event("change"));
}

function selectAuxChannel(channel) {
  auxSelect.value = String(channel);
  localStorage.setItem("aux", String(channel));
  auxSelect.dispatchEvent(new Event("change"));
  document.body.classList.remove("auxPicker");
}

function hideIdentityPicker() {
  identityPickerEl.hidden = true;
}

function showIdentityPicker() {
  identityPickerEl.hidden = false;
  document.body.classList.remove("auxPicker");
}

function showIdentityError(message) {
  let errorEl = identityPickerEl.querySelector(".identity-error");
  if (!errorEl) {
    errorEl = document.createElement("p");
    errorEl.className = "identity-error";
    identityPickerEl.querySelector(".identity-picker-inner").appendChild(errorEl);
  }
  errorEl.textContent = message;
}

function clearIdentityError() {
  const errorEl = identityPickerEl.querySelector(".identity-error");
  if (errorEl) {
    errorEl.remove();
  }
}

function sendIdentify(personId, role) {
  if (!ws) {
    return;
  }
  const payload = { identify: personId };
  if (role) {
    payload.role = role;
  }
  ws.send(JSON.stringify(payload));
}

function renderRolePicker(person) {
  identityListEl.innerHTML = "";
  const heading = document.createElement("p");
  heading.className = "identity-picker-hint";
  heading.textContent = `Hi ${person.name}, which role are you on?`;
  identityListEl.appendChild(heading);

  const rolePicker = document.createElement("div");
  rolePicker.className = "identity-role-picker";

  for (const role of person.roles) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "identity-option";
    button.innerHTML = `<span class="identity-option-name">${role}</span>`;
    button.addEventListener("click", () => {
      clearIdentityError();
      sendIdentify(person.id, role);
    });
    rolePicker.appendChild(button);
  }

  identityListEl.appendChild(rolePicker);
}

function renderIdentityPicker(people) {
  identityListEl.innerHTML = "";
  clearIdentityError();

  for (const person of people) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "identity-option";

    if (person.img) {
      const img = document.createElement("img");
      img.src = person.img;
      img.alt = "";
      button.appendChild(img);
    }

    const text = document.createElement("div");
    const nameEl = document.createElement("div");
    nameEl.className = "identity-option-name";
    nameEl.textContent = person.name;
    text.appendChild(nameEl);

    const roleEl = document.createElement("div");
    roleEl.className = "identity-option-role";
    roleEl.textContent = person.roles.join(", ");
    text.appendChild(roleEl);

    button.appendChild(text);
    button.addEventListener("click", () => {
      clearIdentityError();
      if (person.roles.length > 1) {
        pendingPersonId = person.id;
        renderRolePicker(person);
        return;
      }
      sendIdentify(person.id, person.roles[0]);
    });

    identityListEl.appendChild(button);
  }
}

function maybeShowIdentityPicker() {
  if (!rotaPeople.length) {
    hideIdentityPicker();
    return;
  }

  const storedPersonId = localStorage.getItem("personId");
  if (storedPersonId) {
    hideIdentityPicker();
    if (ws && ws.readyState === WebSocket.OPEN) {
      const person = rotaPeople.find((entry) => entry.id === storedPersonId);
      sendIdentify(storedPersonId, person?.roles?.[0]);
    }
    return;
  }

  showIdentityPicker();
  renderIdentityPicker(rotaPeople);
}

function handleIdentifiedResponse(json) {
  if (!json.identified) {
    showIdentityError(json.error || "Could not identify you");
    if (json.person && !json.error?.includes("No AUX configured")) {
      document.body.classList.add("auxPicker");
    }
    return;
  }

  localStorage.setItem("personId", json.person.id);
  localStorage.setItem("personName", json.person.name);
  hideIdentityPicker();
  selectAuxChannel(json.aux);

  if (json.channels) {
    applyAuxValues({ channels: json.channels });
  }
}

function onMessage(e) {
  let json = JSON.parse(e.data);

  console.log(json);

  if (json.config) {
    rotaPeople = json.config.rotaPeople || [];
    buildAux(json.config.aux);
    buildChannels(json.config.channels);
    maybeShowIdentityPicker();
    return;
  }

  if (json.identified !== undefined) {
    handleIdentifiedResponse(json);
    return;
  }

  if (
    json["aux?"] &&
    json["aux?"] == auxSelect.options[auxSelect.selectedIndex].dataset.channel
  ) {
    applyAuxValues(json);
    return;
  }

  if (json.name != undefined) {
    for (let slider of document.querySelectorAll(
      'input[data-channel="' + json.channel + '"]'
    )) {
      slider.previousElementSibling.innerHTML = json.name;
    }
  }

  if (json.auxname != undefined) {
    for (let option of auxSelect.options) {
      if (option.value == json.channel) {
        option.innerHTML = json.auxname;

        auxSelect.previousElementSibling.innerHTML =
          auxSelect.getElementsByTagName("option")[
            auxSelect.selectedIndex
          ].text;
      }
    }

    for (let button of auxiliaries.getElementsByTagName("button")) {
      if (button.value == json.channel) {
        button.innerText = json.auxname;
        return;
      }
    }
  }

  if (json.aux == auxSelect.options[auxSelect.selectedIndex].dataset.channel) {
    if (json.level != undefined) {
      for (let slider of document.querySelectorAll(
        'input[data-channel="' + json.channel + '"].volumeInput'
      )) {
        slider.value = json.level;
        slider.parentNode.style.setProperty(
          "--value",
          slider.value * 100 + "%"
        );
      }
      return;
    }

    if (json.pan != undefined) {
      for (let slider of document.querySelectorAll(
        'input[data-channel="' + json.channel + '"].panInput'
      )) {
        slider.value = json.pan;
        slider.parentNode.style.setProperty(
          "--value",
          slider.value * 100 + "%"
        );
      }
      return;
    }
  }
}

function buildAux(options) {
  let selectHTML = "";

  auxiliaries.innerHTML = "";

  for (let option of options) {
    selectHTML += `<option value="${option.channel}"
        data-channel="${option.channel}"
        data-colour="${option.colour}" 
        data-stereo="${option.stereo}"
      >
      ${option.label}
      </option>`;

    let button = document.createElement("button");
    button.value = option.channel;
    const imgSrc = option?.user?.img;

    const name = option?.user?.name;

    const leftSide = document.createElement("div");

    leftSide.style = "display: flex; align-items: center; gap: 16px";

    if (imgSrc) {
      const img = document.createElement("img");
      img.style.maxWidth = "40px";
      img.style.margin = "-10px 0";
      img.style.boxShadow = " 0 0  7px rgba(0,0,0,0.6)";
      img.src = imgSrc;

      leftSide.appendChild(img);
    }

    if (name) {
      const nameEl = document.createElement("span");
      nameEl.innerText = name;

      leftSide.appendChild(nameEl);
    }

    button.appendChild(leftSide);

    const txt = document.createElement("span");
    txt.style =
      "color: #fff; font-weight: 100; background: rgba(0,0,0,0.4); border-radius: 8px; padding: 4px 6px;";
    txt.innerHTML = `${option.label}`;

    button.appendChild(txt);

    button.style.setProperty("--tint", option.colour);
    auxiliaries.appendChild(button);
  }

  auxSelect.innerHTML = selectHTML;

  if (localStorage.getItem("aux")) {
    auxSelect.value = localStorage.getItem("aux");
  } else if (!localStorage.getItem("personId")) {
    document.body.classList.add("auxPicker");
  }

  if (!localStorage.getItem("personId")) {
    auxSelect.dispatchEvent(new Event("change"));
  }
}

function auxMouseDown(e) {
  e.preventDefault();
  e.stopImmediatePropagation();
  document.body.classList.add("auxPicker");
}
auxSelect.addEventListener("mousedown", (e) => e.preventDefault());
auxSelect.addEventListener("mouseup", auxMouseDown);

function auxPickerClick(e) {
  if (e.target.nodeName == "BUTTON") {
    auxSelect.value = e.target.value;
    auxSelect.dispatchEvent(new Event("change"));
    document.body.classList.remove("auxPicker");
  }
}
auxiliaries.addEventListener("click", auxPickerClick);

let tapedTwice = false;
function tapSlider(e) {
  if (!tapedTwice) {
    tapedTwice = true;
    setTimeout(function () {
      tapedTwice = false;
    }, 300);
    return false;
  }
  resetSlider(e);
}

function resetSlider(e) {
  e.target.value = 0;
  e.target.dispatchEvent(new Event("input"));
}

function buildChannels(channels) {
  let html = "";
  for (let channel of channels) {
    console.log(channel);
    html += "<div>";
    html +=
      '<label class="volume"><span>' +
      channel.label +
      '</span><input type="range" data-channel="' +
      channel.channel +
      `" class="volumeInput" style=" background: rgba(var(--tint, '6, 106, 166'), 0.4);${""}" step="0.01" min="0" max="1" value="0" /></label>`;
    html +=
      '<label class="pan"><span>' +
      channel.label +
      '</span><input type="range" data-channel="' +
      channel.channel +
      '" class="panInput" step="0.01" min="-1" max="1" value="0" /></label>';
    html +=
      '<label class="favourite starCheckbox"><input type="checkbox" name="fav[]" value="' +
      channel.channel +
      '" title="Mark as Favourite" /></label>';
    html += "</div>";
  }

  channelsDiv.innerHTML = html;

  for (let slider of document.querySelectorAll(".volumeInput, .panInput")) {
    slider.addEventListener("input", sliderChange);
    slider.addEventListener("touchstart", tapSlider);
    slider.addEventListener("dblclick", resetSlider);
  }
}

function onOpen() {
  document.body.classList.remove("disconnected");
  maybeShowIdentityPicker();
}

function noConnection() {
  if (ws) {
    ws.close();
  }
  clearTimeout(timeout);
  timeout = setTimeout(startWebsocket, 2000);
  document.body.classList.add("disconnected");
}

function startWebsocket() {
  ws = new WebSocket("ws://" + document.location.host);
  ws.onopen = onOpen;
  ws.onmessage = onMessage;
  ws.onclose = noConnection;
  ws.onerror = noConnection;
}

document.addEventListener("DOMContentLoaded", function () {
  panCheckbox.checked = false;

  startWebsocket();

  auxSelect.addEventListener("change", function (e) {
    localStorage.setItem("aux", this.value);

    let colour =
      this.getElementsByTagName("option")[this.selectedIndex].dataset.colour;
    document.body.style.setProperty("--tint", colour);

    this.previousElementSibling.innerHTML =
      this.getElementsByTagName("option")[this.selectedIndex].text;

    if (
      this.getElementsByTagName("option")[this.selectedIndex].dataset.stereo ==
      "true"
    ) {
      panCheckbox.parentNode.style.display = "flex";
    } else {
      panCheckbox.parentNode.style.display = "none";
    }

    panCheckbox.checked = false;
    panCheckbox.dispatchEvent(new Event("change"));

    requestValues();
  });

  panCheckbox.addEventListener("change", function (e) {
    if (this.checked) {
      document.body.classList.add("panning");
    } else {
      document.body.classList.remove("panning");
    }
  });

  favourites.addEventListener("change", function (e) {
    channelsDiv.style.overflow = "hidden";
    channelsDiv.scrollTop = 0;
    setTimeout(function () {
      channelsDiv.style.removeProperty("overflow");
    }, 10);

    localStorage.setItem(
      "aux" + auxSelect.value + "favChecked",
      favourites.checked
    );

    for (let fav of document.querySelectorAll('input[name="fav[]"]')) {
      if (fav.checked || !favourites.checked) {
        fav.closest("div").style.removeProperty("display");
      } else {
        fav.closest("div").style.display = "none";
      }
    }

    if (favourites.checked) {
      document.body.classList.add("favourites");
    } else {
      document.body.classList.remove("favourites");
    }
  });

  channelsDiv.addEventListener("change", function (e) {
    if (e.target.name != "fav[]") {
      return;
    }

    let checkedfavs = [];
    for (let checked of document.querySelectorAll(
      'input[name="fav[]"]:checked'
    )) {
      checkedfavs.push(checked.value);
    }
    localStorage.setItem(
      "aux" + auxSelect.value + "fav",
      checkedfavs.join(",")
    );
  });
});
