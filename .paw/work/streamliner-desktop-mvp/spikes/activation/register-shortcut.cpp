#include <windows.h>
#include <shobjidl.h>
#include <propkey.h>
#include <propvarutil.h>
#include <shlobj.h>
#include <string>
#include <iostream>

#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "propsys.lib")

const wchar_t* AUMID = L"Streamliner.Spike.Activation";
const wchar_t* SCHEME = L"streamliner-spike";

bool create_shortcut(const std::wstring& shortcutPath, const std::wstring& target, const std::wstring& args, const std::wstring& workdir) {
    HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    bool didCo = SUCCEEDED(hr);
    IShellLinkW* shellLink = nullptr;
    hr = CoCreateInstance(CLSID_ShellLink, nullptr, CLSCTX_INPROC_SERVER, IID_IShellLinkW, (void**)&shellLink);
    if (FAILED(hr)) { if (didCo) CoUninitialize(); return false; }
    shellLink->SetPath(target.c_str());
    shellLink->SetArguments(args.c_str());
    shellLink->SetWorkingDirectory(workdir.c_str());
    shellLink->SetDescription(L"Streamliner toast activation spike");
    shellLink->SetIconLocation(target.c_str(), 0);
    IPropertyStore* propStore = nullptr;
    hr = shellLink->QueryInterface(IID_IPropertyStore, (void**)&propStore);
    if (SUCCEEDED(hr)) {
        PROPVARIANT pv;
        hr = InitPropVariantFromString(AUMID, &pv);
        if (SUCCEEDED(hr)) {
            propStore->SetValue(PKEY_AppUserModel_ID, pv);
            PropVariantClear(&pv);
        }
        propStore->Commit();
        propStore->Release();
    }
    IPersistFile* persistFile = nullptr;
    hr = shellLink->QueryInterface(IID_IPersistFile, (void**)&persistFile);
    if (SUCCEEDED(hr)) {
        hr = persistFile->Save(shortcutPath.c_str(), TRUE);
        persistFile->Release();
    }
    shellLink->Release();
    if (didCo) CoUninitialize();
    return SUCCEEDED(hr);
}

bool reg_set_string(HKEY root, const std::wstring& subkey, const wchar_t* name, const std::wstring& value) {
    HKEY hKey;
    LONG result = RegCreateKeyExW(root, subkey.c_str(), 0, nullptr, REG_OPTION_NON_VOLATILE, KEY_WRITE, nullptr, &hKey, nullptr);
    if (result != ERROR_SUCCESS) return false;
    result = RegSetValueExW(hKey, name, 0, REG_SZ, (const BYTE*)value.c_str(), (DWORD)((value.size()+1)*sizeof(wchar_t)));
    RegCloseKey(hKey);
    return result == ERROR_SUCCESS;
}

int wmain(int argc, wchar_t** argv) {
    if (argc < 6) {
        std::wcerr << L"usage: register-shortcut.exe <shortcut> <target> <args> <workdir> <handler>\n";
        return 2;
    }
    std::wstring shortcut = argv[1], target = argv[2], args = argv[3], workdir = argv[4], handler = argv[5];
    if (!create_shortcut(shortcut, target, args, workdir)) {
        std::wcerr << L"failed to create shortcut\n";
        return 1;
    }
    std::wstring protocolKey = std::wstring(L"Software\\Classes\\") + SCHEME;
    reg_set_string(HKEY_CURRENT_USER, protocolKey, nullptr, L"URL:Streamliner Spike Protocol");
    reg_set_string(HKEY_CURRENT_USER, protocolKey, L"URL Protocol", L"");
    std::wstring commandKey = protocolKey + L"\\shell\\open\\command";
    std::wstring command = L"\"" + target + L"\" -NoProfile -ExecutionPolicy Bypass -File \"" + handler + L"\" \"%1\"";
    if (!reg_set_string(HKEY_CURRENT_USER, commandKey, nullptr, command)) return 1;
    std::wcout << L"shortcut=" << shortcut << L"\nprotocol=HKCU\\" << protocolKey << L"\ncommand=" << command << L"\n";
    return 0;
}
