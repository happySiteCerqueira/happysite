# Gera ARQUITETURA_SISTEMA.pdf a partir do ARQUITETURA_SISTEMA.md.
#
# Converte o Markdown para HTML (conversor próprio, sem dependências externas) e usa o
# Chrome/Edge em modo headless para imprimir em PDF. Não exige Node, Python ou Pandoc.
#
# Uso:  powershell -ExecutionPolicy Bypass -File gerar-pdf-arquitetura.ps1

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$md   = Join-Path $raiz 'ARQUITETURA_SISTEMA.md'
$html = Join-Path $raiz 'ARQUITETURA_SISTEMA.html'
$pdf  = Join-Path $raiz 'ARQUITETURA_SISTEMA.pdf'

if (-not (Test-Path $md)) { throw "Arquivo não encontrado: $md" }

# ---------- utilitários ----------

function Protect-Html([string]$t) {
    return $t.Replace('&', '&amp;').Replace('<', '&lt;').Replace('>', '&gt;')
}

# Slug no estilo GitHub, para as âncoras do índice funcionarem.
function Get-Slug([string]$t) {
    $s = $t.ToLower()
    $s = [regex]::Replace($s, '[^\p{L}\p{N}\s-]', '')
    $s = $s.Trim() -replace '\s+', '-'
    return $s
}

# Formatação inline: `código`, **negrito**, *itálico*, [texto](link).
function Format-Inline([string]$t) {
    $t = Protect-Html $t

    # Protege os trechos entre crases trocando-os por marcadores, para que ** e * contidos
    # neles não sejam interpretados como negrito/itálico. Depois são restaurados.
    $guardados = New-Object System.Collections.Generic.List[string]
    $sep = [char]1
    while ($true) {
        $m = [regex]::Match($t, '`([^`]+)`')
        if (-not $m.Success) { break }
        $guardados.Add($m.Groups[1].Value)
        $chave = "${sep}C$($guardados.Count - 1)${sep}"
        $t = $t.Remove($m.Index, $m.Length).Insert($m.Index, $chave)
    }

    $t = [regex]::Replace($t, '\*\*([^*]+)\*\*', '<strong>$1</strong>')
    $t = [regex]::Replace($t, '(?<![\*\w])\*([^*\n]+)\*(?!\*)', '<em>$1</em>')
    $t = [regex]::Replace($t, '\[([^\]]+)\]\(([^)]+)\)', '<a href="$2">$1</a>')

    for ($g = 0; $g -lt $guardados.Count; $g++) {
        $t = $t.Replace("${sep}C$g${sep}", '<code>' + $guardados[$g] + '</code>')
    }
    return $t
}

function Format-CelulaTabela([string]$t) {
    # Dentro de tabelas o Markdown usa \| para barra literal.
    return (Format-Inline ($t -replace '\\\|', '|'))
}

# ---------- conversão Markdown -> HTML ----------

$linhas = [System.IO.File]::ReadAllLines($md, [System.Text.Encoding]::UTF8)
$saida = New-Object System.Text.StringBuilder
$n = $linhas.Count
$idx = 0
$global:listaAberta = $null   # 'ul' | 'ol' | $null
$global:saidaRef = $saida

function Close-Lista {
    if ($global:listaAberta) {
        [void]$global:saidaRef.AppendLine("</$($global:listaAberta)>")
        $global:listaAberta = $null
    }
}

while ($idx -lt $n) {
    $linha = $linhas[$idx]

    # --- bloco de código cercado por ``` ---
    if ($linha -match '^\s*```') {
        Close-Lista
        $idx++
        $buffer = New-Object System.Collections.Generic.List[string]
        while ($idx -lt $n -and $linhas[$idx] -notmatch '^\s*```') {
            $buffer.Add($linhas[$idx]); $idx++
        }
        $idx++  # fecha o ```
        [void]$saida.AppendLine('<pre><code>' + (Protect-Html ($buffer -join "`n")) + '</code></pre>')
        continue
    }

    # --- tabela ---
    if ($linha -match '^\s*\|' -and ($idx + 1) -lt $n -and $linhas[$idx + 1] -match '^\s*\|[\s:|-]+\|\s*$') {
        Close-Lista
        $cabecalho = $linha.Trim().Trim('|').Split('|')
        [void]$saida.AppendLine('<table><thead><tr>')
        foreach ($c in $cabecalho) { [void]$saida.AppendLine('<th>' + (Format-CelulaTabela $c.Trim()) + '</th>') }
        [void]$saida.AppendLine('</tr></thead><tbody>')
        $idx += 2
        while ($idx -lt $n -and $linhas[$idx] -match '^\s*\|') {
            $celulas = $linhas[$idx].Trim().Trim('|').Split('|')
            [void]$saida.AppendLine('<tr>')
            foreach ($c in $celulas) { [void]$saida.AppendLine('<td>' + (Format-CelulaTabela $c.Trim()) + '</td>') }
            [void]$saida.AppendLine('</tr>')
            $idx++
        }
        [void]$saida.AppendLine('</tbody></table>')
        continue
    }

    # --- citação (>), podendo conter bloco de código interno ---
    if ($linha -match '^\s*>') {
        Close-Lista
        $buffer = New-Object System.Collections.Generic.List[string]
        while ($idx -lt $n -and $linhas[$idx] -match '^\s*>') {
            $buffer.Add(($linhas[$idx] -replace '^\s*>\s?', ''))
            $idx++
        }
        [void]$saida.AppendLine('<blockquote>')
        $emCodigo = $false
        $codigo = New-Object System.Collections.Generic.List[string]
        $paragrafo = New-Object System.Collections.Generic.List[string]
        foreach ($b in $buffer) {
            if ($b -match '^\s*```') {
                if ($emCodigo) {
                    [void]$saida.AppendLine('<pre><code>' + (Protect-Html ($codigo -join "`n")) + '</code></pre>')
                    $codigo.Clear(); $emCodigo = $false
                } else {
                    if ($paragrafo.Count) {
                        [void]$saida.AppendLine('<p>' + (Format-Inline ($paragrafo -join ' ')) + '</p>')
                        $paragrafo.Clear()
                    }
                    $emCodigo = $true
                }
                continue
            }
            if ($emCodigo) { $codigo.Add($b); continue }
            if ([string]::IsNullOrWhiteSpace($b)) {
                if ($paragrafo.Count) {
                    [void]$saida.AppendLine('<p>' + (Format-Inline ($paragrafo -join ' ')) + '</p>')
                    $paragrafo.Clear()
                }
            } else { $paragrafo.Add($b.Trim()) }
        }
        if ($paragrafo.Count) { [void]$saida.AppendLine('<p>' + (Format-Inline ($paragrafo -join ' ')) + '</p>') }
        [void]$saida.AppendLine('</blockquote>')
        continue
    }

    # --- título ---
    if ($linha -match '^(#{1,6})\s+(.*)$') {
        Close-Lista
        $nivel = $Matches[1].Length
        $texto = $Matches[2].Trim()
        $slug = Get-Slug $texto
        [void]$saida.AppendLine("<h$nivel id=`"$slug`">" + (Format-Inline $texto) + "</h$nivel>")
        $idx++
        continue
    }

    # --- linha horizontal ---
    if ($linha -match '^\s*---+\s*$') {
        Close-Lista
        [void]$saida.AppendLine('<hr>')
        $idx++
        continue
    }

    # --- item de lista ordenada ---
    if ($linha -match '^(\s*)(\d+)\.\s+(.*)$') {
        if ($global:listaAberta -ne 'ol') { Close-Lista; [void]$saida.AppendLine('<ol>'); $global:listaAberta = 'ol' }
        [void]$saida.AppendLine('<li>' + (Format-Inline $Matches[3]) + '</li>')
        $idx++
        continue
    }

    # --- item de lista não ordenada ---
    if ($linha -match '^(\s*)[-*+]\s+(.*)$') {
        $recuo = $Matches[1].Length
        if ($global:listaAberta -ne 'ul') { Close-Lista; [void]$saida.AppendLine('<ul>'); $global:listaAberta = 'ul' }
        $classe = if ($recuo -ge 2) { ' class="sub"' } else { '' }
        [void]$saida.AppendLine("<li$classe>" + (Format-Inline $Matches[2]) + '</li>')
        $idx++
        continue
    }

    # --- linha em branco ---
    if ([string]::IsNullOrWhiteSpace($linha)) {
        Close-Lista
        $idx++
        continue
    }

    # --- parágrafo (junta linhas seguidas) ---
    Close-Lista
    $paragrafo = New-Object System.Collections.Generic.List[string]
    while ($idx -lt $n -and
           -not [string]::IsNullOrWhiteSpace($linhas[$idx]) -and
           $linhas[$idx] -notmatch '^\s*(#{1,6}\s|```|\||>|---+\s*$)' -and
           $linhas[$idx] -notmatch '^(\s*)([-*+]|\d+\.)\s+') {
        $paragrafo.Add($linhas[$idx].Trim())
        $idx++
    }
    if ($paragrafo.Count) {
        [void]$saida.AppendLine('<p>' + (Format-Inline ($paragrafo -join ' ')) + '</p>')
    } else { $idx++ }
}
Close-Lista

# ---------- documento HTML completo ----------
# Paleta alinhada ao DOCUMENTACAO_SISTEMA.html já existente no projeto.

$css = @'
@page { size: A4; margin: 1.6cm 1.4cm; }
* { box-sizing: border-box; }
body {
  font-family: "Segoe UI", Arial, sans-serif;
  color: #1f2937;
  line-height: 1.62;
  font-size: 10.6pt;
  margin: 0 auto;
  max-width: 900px;
  padding: 10px;
}
h1 {
  color: #1e3a8a;
  border-bottom: 4px solid #2563eb;
  padding-bottom: 10px;
  font-size: 25pt;
  margin-bottom: 6px;
}
h2 {
  color: #1e40af;
  background: #eff6ff;
  border-left: 5px solid #2563eb;
  padding: 7px 12px;
  font-size: 15pt;
  margin-top: 30px;
  page-break-after: avoid;
  break-after: avoid;
}
h3 {
  color: #1e40af;
  font-size: 12.5pt;
  margin-top: 22px;
  border-bottom: 1px solid #dbeafe;
  padding-bottom: 4px;
  page-break-after: avoid;
  break-after: avoid;
}
h4 { color: #374151; font-size: 11pt; margin-top: 16px; }
p { margin: 9px 0; text-align: justify; }
a { color: #1d4ed8; text-decoration: none; }
code {
  font-family: Consolas, "Courier New", monospace;
  background: #f1f5f9;
  color: #b91c1c;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 9.2pt;
  white-space: nowrap;
}
pre {
  background: #0f172a;
  color: #e2e8f0;
  padding: 11px 14px;
  border-radius: 7px;
  overflow-x: auto;
  font-size: 8.6pt;
  line-height: 1.45;
  page-break-inside: avoid;
  break-inside: avoid;
}
pre code {
  background: none;
  color: inherit;
  padding: 0;
  font-size: inherit;
  white-space: pre;
}
table {
  border-collapse: collapse;
  width: 100%;
  margin: 13px 0;
  font-size: 9.1pt;
  page-break-inside: avoid;
  break-inside: avoid;
}
th {
  background: #1e40af;
  color: #fff;
  text-align: left;
  padding: 7px 9px;
  font-weight: 600;
}
td {
  border: 1px solid #e5e7eb;
  padding: 6px 9px;
  vertical-align: top;
}
tr:nth-child(even) td { background: #f8fafc; }
blockquote {
  background: #fffbeb;
  border-left: 5px solid #f59e0b;
  margin: 13px 0;
  padding: 9px 14px;
  page-break-inside: avoid;
  break-inside: avoid;
}
blockquote p { margin: 5px 0; }
blockquote pre { margin: 7px 0; }
ul, ol { margin: 9px 0; padding-left: 26px; }
li { margin: 4px 0; }
li.sub { margin-left: 18px; list-style-type: circle; }
hr { border: none; border-top: 1px solid #e5e7eb; margin: 22px 0; }
strong { color: #111827; }
'@

$corpo = $saida.ToString()
$doc = @"
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>HappySite - Manual de Arquitetura</title>
<style>
$css
</style>
</head>
<body>
$corpo
</body>
</html>
"@

# UTF-8 sem BOM, com <meta charset> declarado — evita acentos corrompidos no PDF.
$utf8SemBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($html, $doc, $utf8SemBom)
Write-Host "HTML gerado: $html"

# ---------- HTML -> PDF via navegador headless ----------

$navegadores = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
)
$navegador = $navegadores | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $navegador) { throw 'Chrome ou Edge não encontrado para gerar o PDF.' }
Write-Host "Navegador: $navegador"

if (Test-Path $pdf) { Remove-Item -LiteralPath $pdf -Force }

$uri = ([System.Uri]$html).AbsoluteUri
$perfil = Join-Path $env:TEMP "chrome-pdf-$PID"

$argumentos = @(
    '--headless=new'
    '--disable-gpu'
    '--no-sandbox'
    '--no-pdf-header-footer'
    "--user-data-dir=$perfil"
    "--print-to-pdf=$pdf"
    $uri
)

& $navegador @argumentos 2>&1 | Out-Null

# O navegador pode liberar o processo antes de terminar de escrever o arquivo.
$limite = (Get-Date).AddSeconds(90)
while ((Get-Date) -lt $limite) {
    if (Test-Path $pdf) {
        $tamanho = (Get-Item $pdf).Length
        Start-Sleep -Seconds 2
        if ((Get-Item $pdf).Length -eq $tamanho -and $tamanho -gt 0) { break }
    } else { Start-Sleep -Seconds 2 }
}

Remove-Item -LiteralPath $perfil -Recurse -Force -ErrorAction SilentlyContinue

if (Test-Path $pdf) {
    $kb = [math]::Round((Get-Item $pdf).Length / 1KB, 1)
    Write-Host "PDF gerado: $pdf ($kb KB)"
} else {
    throw 'Falha ao gerar o PDF.'
}
