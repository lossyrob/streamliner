#include <windows.h>
#include <shobjidl.h>
#include <propkey.h>
#include <propvarutil.h>
#include <iostream>
int wmain(int argc, wchar_t** argv) {
  if (argc < 2) return 2;
  CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  IShellLinkW* link=nullptr; HRESULT hr=CoCreateInstance(CLSID_ShellLink,nullptr,CLSCTX_INPROC_SERVER,IID_IShellLinkW,(void**)&link);
  if (FAILED(hr)) return 1;
  IPersistFile* pf=nullptr; hr=link->QueryInterface(IID_IPersistFile,(void**)&pf); if (FAILED(hr)) return 1;
  hr=pf->Load(argv[1], STGM_READ); pf->Release(); if (FAILED(hr)) { std::wcerr<<L"load failed"; return 1; }
  IPropertyStore* ps=nullptr; hr=link->QueryInterface(IID_IPropertyStore,(void**)&ps); if (FAILED(hr)) { std::wcerr<<L"propstore failed"; return 1; }
  PROPVARIANT pv; PropVariantInit(&pv); hr=ps->GetValue(PKEY_AppUserModel_ID,&pv); if (FAILED(hr)) return 1;
  PWSTR s=nullptr; hr=PropVariantToStringAlloc(pv,&s); if (SUCCEEDED(hr)) { std::wcout << L"AppUserModelID=" << s << L"\n"; CoTaskMemFree(s); }
  PropVariantClear(&pv); ps->Release(); link->Release(); CoUninitialize(); return SUCCEEDED(hr) ? 0 : 1;
}
