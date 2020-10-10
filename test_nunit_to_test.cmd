
@rem list files in nunit.txt 
dir /s /b *.nunit.js >nunit.txt

for /F  %%i in (nunit.txt) do @echo %%~dpni >>bare.txt
for /F  %%i in (bare.txt) do @echo %%~dpni

for /F  %%i in (bare.txt) do mv %%i.js %%~dpni.test.js

jscodeshift test
