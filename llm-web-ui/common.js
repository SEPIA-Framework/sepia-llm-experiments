//URL parameter handling:

const startUrlParams = new URLSearchParams(window.location.search);
const urlParamColorScheme = startUrlParams.get('color');

function updateUrlParameter(key, value, reloadPage){
	var currentUrl = new URL(window.location.href);
	var currentUrlParams = new URLSearchParams(currentUrl.search);
	currentUrlParams.set(key, value);
	currentUrl.search = currentUrlParams.toString();
	if (reloadPage){
		window.location.search = currentUrlParams.toString();
	}else{
		window.history.replaceState(null, "", currentUrl.toString());
	}
}
function loadScript(url) {
	return new Promise((resolve, reject) => {
		const script = document.createElement('script');
		script.src = url;
		script.onload = resolve;
		script.onerror = reject;
		document.head.appendChild(script);
	});
}
function loadJSON(url) {
	return fetch(url).then(response => {
		if (response.status != 200){
			var msg = response.statusText || (response.status == 404? "File not found" : "");
			throw {message: msg, code: response.status, response: response};
		}else{
			return response.json();
		}
	});
}
async function loadScripts(urls) {
	for (const url of urls) {
		await loadScript(url);
	}
}
function loadCSS(url) {
	const link = document.createElement('link');
	link.rel = 'stylesheet';
	link.href = url;
	document.head.appendChild(link);
}

//Common UI:

var mainView = document.body.querySelector(".main-view");
var mainHeadline = document.getElementById("main-headline");
var appIconSvg = document.getElementById("app-icon");
var navMenu = document.body.querySelector(".nav-menu");
var optionsMenu = document.body.querySelector(".options-menu");
var contentPage = mainView.querySelector(".content-page");		//TODO: I think this is actually the only global var used outside

var colorStyle = "light";		
var optionDarkMode = optionsMenu.querySelector("[name=option-dark-mode]");
optionDarkMode.onchange = function(){ toggleColorStyle(true); };
optionDarkMode.checked = false;

function toggleNavMenu(){
	if (navMenu.classList.contains("hidden")){
		navMenu.classList.remove("hidden");
		optionsMenu.classList.add("hidden");
	}else{
		navMenu.classList.add("hidden");
	}
}
function toggleOptionsMenu(){
	if (optionsMenu.classList.contains("hidden")){
		optionsMenu.classList.remove("hidden");
		navMenu.classList.add("hidden");
	}else{
		optionsMenu.classList.add("hidden");
	}
}

function setColorStyle(style, writeUrlParam){
	if (style == "light"){
		colorStyle = "light";
		optionDarkMode.checked = false;
		document.documentElement.classList.remove("dark");
		//appIconSvg.querySelectorAll("path")[1].style.fill = "#000";
		if (writeUrlParam){
			updateUrlParameter("color", "light");
		}
	}else{
		colorStyle = "dark";
		optionDarkMode.checked = true;
		document.documentElement.classList.add("dark");
		//appIconSvg.querySelectorAll("path")[1].style.fill = "#EBE9E8";
		if (writeUrlParam){
			updateUrlParameter("color", "dark");
		}
	}
}
function toggleColorStyle(writeUrlParam){
	if (colorStyle == "light") setColorStyle("dark", writeUrlParam);
	else setColorStyle("light", writeUrlParam);
}
if (urlParamColorScheme){
	setColorStyle(urlParamColorScheme);
}else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches){
	setColorStyle("dark");
}else{
	setColorStyle("light");
}
appIconSvg.addEventListener("click", toggleColorStyle);

//UI components:

function showPopUp(content, buttons, options){
	mainView.inert = true;	//lock main
	document.body.classList.add("disable-interaction");
	var popUpOverlay = document.createElement("div");
	popUpOverlay.className = "pop-up-overlay";
	var popUpBox = document.createElement("div");
	popUpBox.className = "pop-up-message-box";
	if (options?.width){
		popUpBox.style.width = options.width;
	}
	var popUpCloseBtn = document.createElement("button");
	popUpCloseBtn.className = "pop-up-message-box-close";
	//popUpCloseBtn.innerHTML = "<span>×</span>";
	popUpBox.appendChild(popUpCloseBtn);
	var contentDiv = document.createElement("div");
	contentDiv.className = "pop-up-content";
	popUpBox.appendChild(contentDiv);
	if (typeof content == "string"){
		contentDiv.innerHTML = content;
	}else{
		contentDiv.appendChild(content);
	}
	//buttons
	if (buttons && buttons.length){
		//TODO: implement
	}
	//close function
	var isClosed = false;
	popUpOverlay.popUpClose = function(){
		if (isClosed) return;
		mainView.inert = false;	//release main
		document.body.classList.remove("disable-interaction");
		popUpOverlay.remove();
		isClosed = true;
	}
	popUpCloseBtn.addEventListener("click", function(ev){
		popUpOverlay.popUpClose();
	});
	if (options?.easyClose){
		popUpOverlay.addEventListener("click", function(ev){
			ev.stopPropagation();
			if (ev.target != this) return;	//ignore bubble events
			popUpOverlay.popUpClose();
		});
	}
	//append and open
	popUpOverlay.appendChild(popUpBox);
	document.body.appendChild(popUpOverlay);			
	return popUpOverlay;
}
function showFormPopUp(formFields, onSubmit){
	var formEle = document.createElement("form");
	var customData = {};
	formFields.forEach(function(field, i){
		var formSection = document.createElement("div");
		formSection.className = "form-section";
		if (field.label){
			let ele = document.createElement("label");
			ele.textContent = field.label;
			formSection.appendChild(ele);
		}else if (field.spacer){
			let ele = document.createElement("div");
			formSection.appendChild(ele);
		}
		if (field.input || field.checkbox){
			let ele = document.createElement("input");
			if (field.input){
				if (field.pattern){
					ele.pattern = field.pattern;
				}
				ele.value = field.value;
			}else if (field.checkbox){
				ele.type = "checkbox";
				formSection.classList.add("row");
				ele.checked = field.value;
			}
			if (field.required){
				ele.required = true;
			}
			if (field.title){
				ele.title = field.title;
			}
			ele.name = field.name || ("field" + i);
			formSection.appendChild(ele);
		
		}else if (field.select){
			let ele = document.createElement("select");
			let optGroups = {};
			field.select.options?.forEach(function(opt){
				var optGrp;
				if (opt.group){
					optGrp = optGroups[opt.group];
					if (!optGrp){
						optGrp = document.createElement("optgroup");
						optGrp.label = opt.group;
						optGroups[opt.group] = optGrp;
						ele.add(optGrp);
					}
				}
				var optEle = document.createElement("option");
				optEle.value = opt.value == undefined? (opt.name || opt.label) : opt.value;
				optEle.text = opt.name || opt.label;
				if (optGrp){
					optGrp.appendChild(optEle);
				}else{
					ele.add(optEle);
				}
			});
			if (field.title){
				ele.title = field.title;
			}
			if (field.select.onChange){
				ele.addEventListener("change", function(){
					field.select.onChange(ele.value);
				});
			}
			ele.value = field.value;
			ele.name = field.name || ("field" + i);
			formSection.appendChild(ele);
		
		}else if (field.customElement){
			formSection.appendChild(field.customElement);
		
		}else if (field.customButton){
			let ele = document.createElement("input");
			ele.type = "button";
			ele.className = "button-style";
			ele.value = field.customButton.name || "Press";
			ele.addEventListener("click", function(){ 
				if (field.customButton.fun) field.customButton.fun();
			});
			formSection.appendChild(ele);
		}
		if (field.submit){
			let ele = document.createElement("input");
			ele.type = "submit";
			ele.className = "button-style";
			ele.value = field.name || "Submit";
			formSection.appendChild(ele);
		}
		formEle.appendChild(formSection);
	});
	formEle.addEventListener("submit", function(ev){
		ev.preventDefault();
		var formData = new FormData(ev.target);
		if (onSubmit) onSubmit(formData, customData);
		popUp.popUpClose();
	});
	var popUp = showPopUp(formEle, [], {easyClose: false});
	return {popUp, form: formEle};
}
function showList(items, options, onSelectCallback){
	var content = document.createElement("div");
	content.style.cssText = "display: flex; flex-direction: column; max-height: 100%;";
	var list = document.createElement("div");
	list.className = "list-container";
	var addedGroupLabels = {};
	items.forEach(function(itm){
		var loadFun = function(ev){
			if (onSelectCallback) onSelectCallback(itm);
			popUp.popUpClose();
		};
		var item = document.createElement("div");
		item.className = "list-item smaller-item button-style";
		item.setAttribute("tabindex", "0");
		item.addEventListener("click", loadFun);
		item.addEventListener('keypress', function(ev){
			if (ev.key === 'Enter' && ev.target == item) {
			  loadFun(ev);
			}
		});
		var itemDesc = document.createElement("div");
		itemDesc.className = "list-item-desc";
		itemDesc.textContent = itm.name || itm.label;
		item.appendChild(itemDesc);
		if (itm.group){
			if (!addedGroupLabels[itm.group]){
				let label = document.createElement("label");
				label.className = "list-label";
				addedGroupLabels[itm.group] = label;
				label.textContent = itm.group;
				list.appendChild(label);
			}
		}
		list.appendChild(item);
	});
	if (options?.infoText){
		var info = document.createElement("p");
		info.textContent = options.infoText;
		content.appendChild(info);
	}
	content.appendChild(list);
	if (options?.footerText){
		var footer = document.createElement("p");
		footer.textContent = options.footerText;
		content.appendChild(footer);
	}
	var popUp = showPopUp(content, [], {easyClose: false});
	return {popUp, list};
}

//Store/load/delete/export etc.:

var localStorageSupported = ("localStorage" in window && typeof localStorage.getItem == "function");

function saveAs(filename, dataObj, parentViewEle){
	if (!filename || !dataObj) return;
	var blob = new Blob([JSON.stringify(dataObj)], {
		type: 'text/plain'
	});
	if (navigator.msSaveBlob) return navigator.msSaveBlob(blob, filename);
	var dummyEle = parentViewEle || document.body;
	var a = document.createElement('a');
	a.style.cssText = "max-width: 0px; max-height: 0px; margin: 0; padding: 0;";
	dummyEle.appendChild(a);
	var url = window.URL.createObjectURL(blob);
	a.href = url;
	a.download = filename;
	a.click();
	setTimeout(function(){
		window.URL.revokeObjectURL(url);
		dummyEle.removeChild(a);
	}, 0);
}
