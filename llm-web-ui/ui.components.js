import * as chatHistory from "./chat.history.js"
import * as llmSettings from "./llm.settings.js"
import * as llmInterface from "./llm.interface.js"

var chat = {
	history: chatHistory
}
var llm = {
	settings: llmSettings,
	interface: llmInterface
}

//handlers to check and manipulate main UI (see app.js)
var chatUiHandlers;

export function setup(chatUiHandl){
	return new Promise((resolve, reject) => {
		chatUiHandlers = chatUiHandl;
		resolve();
	});
}

export function showSystemPromptEditor(disableEdit, onCloseCallback){
	var content = buildSystemPromptEditComponent("55vh", disableEdit);
	var sysPromptInfo = llm.settings.getSystemPromptInfo();
	var customSystemPrompt = llm.settings.getCustomSystemPrompt();
	if ((!sysPromptInfo || sysPromptInfo.value == "custom") && customSystemPrompt){
		content.setSystemPrompt(customSystemPrompt);
	}
	var buttons;
	if (disableEdit){
		buttons = [{
			name: "Go back",
			closeAfterClick: true
		}];
	}else{
		buttons = [{
			name: "Save",
			fun: function(){
				llm.settings.setSystemPromptInfo("custom");
				llm.settings.setCustomSystemPrompt(content.getSystemPrompt());
				llm.settings.loadSystemPrompt().catch((err) => {
					console.error("Failed to load system prompt.", err);
					showPopUp("ERROR: " + (err?.message || "Failed to load system prompt."));
				});
			},
			closeAfterClick: true
		},{
			name: "Import",
			fun: function(){
				openTextFilePrompt(function(txt){
					importText(txt);
				}, function(err){
					console.error("Failed to load file:", err);		//DEBUG
					showPopUp("Failed to load file.");
				});
			}
		}];
		if (chat.history.getActiveHistory()){
			buttons.push({
				name: "Edit history",
				fun: function(){
					showChatHistoryEditor(undefined, onCloseCallback);
				},
				closeAfterClick: true,
				skipCloseCallback: true
			});
		}
		buttons.push({
			name: "Count tokens",
			fun: function(){
				countTokensAndShowResult();
			},
			closeAfterClick: false
		});
		buttons.push({
			name: "Close",
			closeAfterClick: true
		});
		addDragAndDropFileImport(content, function(txt){	//TODO: handle 'disableEdit' here?
			importText(txt);
		}, function(err){
			console.error("Failed to load file:", err);		//DEBUG
			showPopUp("Failed to load file.");
		},{
			fileType: "text/plain"
		});
		var importText = function(txt){
			try {
				var txtJson = JSON.parse(txt);
				restoreSystemPromptAndHistory(txtJson).then(() => {
					pop.popUpClose(true);
					showSystemPromptEditor(undefined, onCloseCallback);
				}).catch((err) => {
					console.error("Failed to load file:", err);		//DEBUG
					showPopUp("Failed to load file. JSON data seems to be corrupted.");
				});
			}catch (err){
				console.error("Failed to load file. Could not parse JSON data:", err);		//DEBUG
				showPopUp("Failed to load file. Could not parse JSON data.");
			}
		}
	}
	var pop = showPopUp(content, buttons, {
		width: "1024px"
	}, onCloseCallback);
}
function buildSystemPromptEditComponent(txtareaHeight, disableEdit){
	var content = document.createElement("div");
	content.className = "section-wrapper";
	var info = document.createElement("p");
	if (disableEdit){
		info.textContent = "This is your active system prompt. To edit it, please close the active chat first.";
	}else{
		info.textContent = "Here you can add/edit your system prompt:";
	}
	//prompt text
	var textC = document.createElement("div");
	textC.className = "text-container";
	var txt = document.createElement("textarea");
	if (txtareaHeight){
		txt.style.height = (typeof txtareaHeight == "number")? (txtareaHeight + "px") : txtareaHeight;
	}
	var sysPromptInfo = llm.settings.getSystemPromptInfo();
	if (!sysPromptInfo || sysPromptInfo.value == "custom"){
		txt.placeholder = ("Enter your prompt here.");
	}else{
		txt.placeholder = ("Currently selected preset:\n" + sysPromptInfo.name);
	}
	if (disableEdit){
		txt.disabled = true;
		txt.title = "To edit your system prompt, please close the current chat first.";
	}
	textC.appendChild(txt);
	//tools manage section
	var infoTools = document.createElement("p");
	infoTools.textContent = "Add tools (will be used if enabled and supported):";
	infoTools.title = "Add your tool functions here. If tools are enabled (settings) and the model supports tools, they will be appended automatically to your system prompt.";
	var toolsSec = document.createElement("div");
	toolsSec.className = "tools-list-container";
	toolsSec.style.cssText = "margin: 0px 0 8px 0;";
	if (!disableEdit){
		var addToolButton = document.createElement("button");
		addToolButton.innerHTML = "+ Add Tool";
		addToolButton.addEventListener("click", function(){
			buildPromptToolEditor("", disableEdit, function(toolDef){
				//add/update
				if (!llm.settings.hasSystemPromptTool(toolDef)){
					//add button if not exists
					addPromptToolButton(toolDef, toolsSec, disableEdit);
				}
				llm.settings.setSystemPromptTool(toolDef);	//update always
			});
		});
		toolsSec.appendChild(addToolButton);
	}
	llm.settings.getSystemPromptToolsArray()?.forEach(td => {
		addPromptToolButton(td, toolsSec, disableEdit);
	});
	//add functions
	content.appendChild(info);
	content.appendChild(textC);
	content.appendChild(infoTools);
	content.appendChild(toolsSec);
	content.getSystemPrompt = function(){
		return txt.value;
	};
	content.setSystemPrompt = function(newVal){
		txt.value = newVal;
	};
	return content;
}
function buildPromptToolEditor(toolDef, disableEdit, onAddUpdateCallback, onRemoveCallback, onCloseCallback){
	var content = document.createElement("div");
	content.className = "section-wrapper";
	var info = document.createElement("p");
	if (disableEdit){
		info.textContent = "This is your tool function definition.";
	}else{
		info.textContent = "Here you can add/edit your tool function definition:";
	}
	//templates
	if (!disableEdit){
		var templateSelectorBox = document.createElement("div");
		templateSelectorBox.className = "aligned-items";
		templateSelectorBox.style.cssText = "margin-bottom: 8px;";
		templateSelectorBox.innerHTML = "<label>Available templates:</label>";
		var templateSelector = document.createElement("select");
		templateSelector.addEventListener("change", function(){
			var json = JSON.parse(this.value);
			txt.value = JSON.stringify(json, null, 2);
		});
		templateSelectorBox.appendChild(templateSelector);
		//- load template file
		loadFile("system-prompts/tools/function-templates.txt", "json").then((templatesArray) => {
			if (!templatesArray || templatesArray.length == 0){
				templateSelector.innerHTML = "<option>- NOT FOUND -</option>";
			}else{
				templateSelector.innerHTML = "<option disabled selected>- SELECT -</option>";
				templatesArray.forEach(funDef => {
					var opt = document.createElement("option");
					opt.textContent = funDef.function?.name;
					opt.value = JSON.stringify(funDef);
					templateSelector.appendChild(opt);
				});
			}
		}).catch((err) => {
			console.error("buildPromptToolEditor - failed to load templates:", err);
			templateSelector.innerHTML = "<option>- ERROR -</option>";
		});
	}
	//tool def.
	var textC = document.createElement("div");
	textC.className = "text-container";
	var txt = document.createElement("textarea");
	txt.style.cssText = "height: 50vh; white-space: pre; overflow-x: auto;";
	txt.placeholder = "Enter JSON tool definition here.";
	if (toolDef){
		if (typeof toolDef == "object") txt.value = JSON.stringify(toolDef, null, 2);
		else txt.value = JSON.stringify(JSON.parse(toolDef), null, 2);
	}
	if (disableEdit){
		txt.disabled = true;
		txt.title = "To edit your tool definition, please close the current chat first.";
	}
	textC.appendChild(txt);
	content.appendChild(info);
	if (!disableEdit) content.appendChild(templateSelectorBox);
	content.appendChild(textC);
	//buttons
	var buttons;
	if (disableEdit){
		buttons = [{
			name: "Go back",
			fun: onCloseCallback,
			closeAfterClick: true
		}];
	}else{
		buttons = [{
			name: "Add/Update",
			fun: function(){
				//llm.settings.setToolInfo(functioName, def);
				if (txt.value){
					try {
						var defJson = JSON.parse(txt.value);
					}catch(err){
						showPopUp("Invalid JSON - Check code plz.");
						return false;		//suppress close action
					}
					var valid = defJson.type == "function" && defJson.function?.name;	//TODO: add more checks
					if (!valid){
						showPopUp("Invalid JSON format - Check template plz.");
						return false;
					}else{
						if (onAddUpdateCallback) onAddUpdateCallback(defJson);
						return true;
					}
				}else{
					showPopUp("JSON cannot be empty.");
					return false;
				}
			},
			closeAfterClick: true
		}];
		if (onRemoveCallback){
			buttons.push({
				name: "Remove",
				fun: function(){
					onRemoveCallback();
				},
				closeAfterClick: true
			});
		}
		buttons.push({
			name: "Close",
			fun: onCloseCallback,
			closeAfterClick: true
		});
	}
	var pop = showPopUp(content, buttons, {
		width: "800px"
	});
}
function addPromptToolButton(toolDef, toolsSec, disableEdit){
	if (typeof toolDef == "string") toolDef = JSON.parse(toolDef);
	var newButton = document.createElement("button");
	newButton.textContent = toolDef.function.name;	//NOTE: we assume this format is always given
	newButton.addEventListener("click", function(){
		buildPromptToolEditor(toolDef, disableEdit, function(newDef){
			//add/update
			llm.settings.setSystemPromptTool(newDef);
		}, function(){
			//remove
			llm.settings.removeSystemPromptTool(toolDef);
			newButton.remove();
		}, function(){
			//close
		});
	});
	toolsSec.appendChild(newButton);
}

export function showChatHistoryEditor(todo_disableEdit, onCloseCallback){
	//TODO: implement 'disableEdit'
	var content = buildChatHistoryListComponent();
	var buttons = [{
		name: "Export",
		fun: function(){
			var data = exportSystemPromptAndHistory();
			saveAs("my-chat.txt", data);
		},
		closeAfterClick: false
	},{
		name: "Import",
		fun: function(){
			openTextFilePrompt(function(txt){
				importText(txt);
			}, function(err){
				console.error("Failed to load file:", err);		//DEBUG
				showPopUp("Failed to load file.");
			});
		},
		closeAfterClick: false
	},{
		name: "Count tokens",
		fun: function(){
			countTokensAndShowResult();
		},
		closeAfterClick: false
	},{
		name: "Clear all",
		fun: function(){
			chat.history.update(llm.settings.getActiveServerSlot(), []);
			chat.history.clearHistoryCache();
			chatUiHandlers.clearChatMessages();
			pop.popUpClose(true);
			showChatHistoryEditor(undefined, onCloseCallback);
		},
		closeAfterClick: false
	},{
		name: "Show prompt",
		fun: function(){
			var disableEdit = !chatUiHandlers.isChatClosed();
			showSystemPromptEditor(disableEdit, onCloseCallback);
		},
		closeAfterClick: chatUiHandlers.isChatClosed(),
		skipCloseCallback: chatUiHandlers.isChatClosed()
	},{
		name: "Close",
		closeAfterClick: true
	}];
	addDragAndDropFileImport(content, function(txt){	//TODO: handle 'disableEdit' here?
		importText(txt);
	}, function(err){
		console.error("Failed to load file:", err);		//DEBUG
		showPopUp("Failed to load file.");
	},{
		fileType: "text/plain"
	});
	var pop = showPopUp(content, buttons, {
		width: "800px"
	}, onCloseCallback);
	var importText = function(txt){
		try {
			var txtJson = JSON.parse(txt);
			restoreSystemPromptAndHistory(txtJson).then(() => {
				pop.popUpClose(true);
				showChatHistoryEditor(undefined, onCloseCallback);
			}).catch((err) => {
				console.error("Failed to load file:", err);		//DEBUG
				showPopUp("Failed to load file. JSON data seems to be corrupted.");
			});
		}catch (err){
			console.error("Failed to load file. Could not parse JSON data:", err);		//DEBUG
			showPopUp("Failed to load file. Could not parse JSON data.");
		}
	}
}
function buildChatHistoryListComponent(){
	var content = document.createElement("div");
	content.className = "section-wrapper";
	var info = document.createElement("p");
	info.textContent = "Here you can edit your chat history:";
	var list = document.createElement("div");
	list.className = "list-container";
	content.appendChild(list);
	var slotHistory = chat.history.getActiveHistory();
	if (!slotHistory?.length){
		list.innerHTML = "<p style='text-align: center;'>- no history yet -</p>";
		return content;
	}
	slotHistory.filter((itm) => { return itm.role != "removed" }).forEach(function(entry, i){
		var item = document.createElement("div");
		item.className = "list-item history-entry";
		var wrap = document.createElement("div");
		wrap.className = "entry-wrapper";
		var header = document.createElement("div");
		header.className = "entry-header";
		var role = document.createElement("span");
		if (entry.role == "user") role.className = "role-user";
		else if (entry.role == "assistant") role.className = "role-assistant";
		var entryIndex = (i+1);
		role.textContent = entryIndex + ". " + entry.role;
		var timestamp = document.createElement("span");
		timestamp.className = "chat-hist-time";
		timestamp.textContent = new Date(entry.timestamp || Date.now()).toLocaleString();
		header.appendChild(role);
		header.appendChild(timestamp);
		var previewTxt = document.createElement("div");
		previewTxt.className = "list-item-desc";
		previewTxt.setAttribute("tabindex", "0");
		var prevTxtSpan = document.createElement("span");
		prevTxtSpan.textContent = entry.content;
		previewTxt.appendChild(prevTxtSpan);
		wrap.addEventListener("click", function(){
			var pop = showTextEditor(entry.content, {
				intro: "Edit history at index " + entryIndex + ":",
				placeholder: "Your chat history",
				width: "800px"
			}, function(newTxt){
				entry.content = newTxt;
				prevTxtSpan.textContent = newTxt;
			});
		});
		wrap.appendChild(header);
		wrap.appendChild(previewTxt);
		var removeBtn = document.createElement("button");
		removeBtn.innerHTML = '<svg viewBox="0 0 16 16" style="width: 14px; fill: currentColor;"><use xlink:href="#svg-minus-btn"></use></svg>';
		removeBtn.addEventListener("click", function(){
			entry.role = "removed";
			entry.content = "";
			item.remove();
		});
		item.appendChild(wrap);
		item.appendChild(removeBtn);
		list.appendChild(item);
	});
	return content;
}

function countTokensAndShowResult(){
	llm.interface.getTokens().then((res) => {
		if (res?.tokens){
			var msg = "Total tokens (system prompt + chat history): " + res.tokens.length + "<br>";
			if (res.modelContextLength){
				msg += "Model context length: " + res.modelContextLength + "<br>";
				if (res.modelContextLength < res.tokens.length){
					msg += "<br>Your chat history exceeds the context length! This means that the model will not be able to remember your whole chat anymore.";
				}
			}
			showPopUp(msg, undefined, {width: "480px"});
		}else{
			showPopUp("Failed to count tokens, sorry. Tokenizer returned invalid data.");
		}
	}).catch((err) => {
		console.error("Failed to count tokens:", err);		//DEBUG
		showPopUp("Failed to count tokens, sorry. Please check server connection.");
	});
}

function exportSystemPromptAndHistory(){
	var sysPromptInfo = llm.settings.getSystemPromptInfo();
	return {
		systemPromptSelected: sysPromptInfo.value,
		systemPrompt: ((sysPromptInfo.value == "custom")? llm.settings.getCustomSystemPrompt() : ""),
		history: chat.history.getActiveHistory()
	}
}
function restoreSystemPromptAndHistory(data){
	llm.settings.setSystemPromptInfo(data.systemPromptSelected);
	llm.settings.setCustomSystemPrompt(data.systemPrompt);
	if (chatUiHandlers.isChatClosed()){
		chat.history.cacheHistoryForRestore(data.history);
	}else{
		chat.history.restore(data.history);
	}
	llm.settings.setSystemPromptInfo(data.systemPromptSelected);
	return llm.settings.loadSystemPrompt(data.systemPromptSelected);
}